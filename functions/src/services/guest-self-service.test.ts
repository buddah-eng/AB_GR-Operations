/**
 * Tests for Guest Self-Service Service
 *
 * Covers:
 * - createFormSession (token generation, guest validation, expiration)
 * - invalidateSession
 * - getSessionByTokenHash
 * - getSessionsForGuest
 * - getFormPrefill (guest data, registry data, merge logic)
 * - submitForm (validation, guest update, registry update, status)
 * - rowToFormSession mapping
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const mockClient = { query: mockQuery };
    return fn(mockClient);
  },
}));

// --- Import module under test ---

import {
  createFormSession,
  invalidateSession,
  getSessionByTokenHash,
  getSessionsForGuest,
  getFormPrefill,
  submitForm,
  rowToFormSession,
} from "./guest-self-service";

// --- Test data ---

const makeSessionRow = (overrides?: Partial<Record<string, unknown>>): Record<string, unknown> => ({
  id: "session-1",
  token_hash: "abc123hash",
  guest_id: "guest-1",
  form_data: { dietary: "vegan" },
  status: "active",
  created_at: new Date("2026-04-01T00:00:00Z"),
  expires_at: new Date("2026-05-01T00:00:00Z"),
  submitted_at: null,
  last_saved_at: null,
  ...overrides,
});

const makeMockClient = () => ({
  query: mockQuery,
});

// ============================================================================
// rowToFormSession tests
// ============================================================================

describe("rowToFormSession", () => {
  it("maps DB row to FormSession", () => {
    const row = makeSessionRow();
    const session = rowToFormSession(row);

    expect(session.id).toBe("session-1");
    expect(session.token_hash).toBe("abc123hash");
    expect(session.guest_id).toBe("guest-1");
    expect(session.status).toBe("active");
    expect(session.form_data).toEqual({ dietary: "vegan" });
    expect(session.submitted_at).toBeNull();
    expect(session.last_saved_at).toBeNull();
  });

  it("converts Date fields to ISO strings", () => {
    const row = makeSessionRow({
      submitted_at: new Date("2026-04-05T12:00:00Z"),
      last_saved_at: new Date("2026-04-04T10:00:00Z"),
    });
    const session = rowToFormSession(row);

    expect(session.submitted_at).toBe("2026-04-05T12:00:00.000Z");
    expect(session.last_saved_at).toBe("2026-04-04T10:00:00.000Z");
  });

  it("handles string date fields", () => {
    const row = makeSessionRow({
      created_at: "2026-04-01T00:00:00Z",
      expires_at: "2026-05-01T00:00:00Z",
    });
    const session = rowToFormSession(row);

    expect(session.created_at).toBe("2026-04-01T00:00:00Z");
    expect(session.expires_at).toBe("2026-05-01T00:00:00Z");
  });

  it("defaults form_data to empty object", () => {
    const row = makeSessionRow({ form_data: null });
    const session = rowToFormSession(row);

    expect(session.form_data).toEqual({});
  });
});

// ============================================================================
// createFormSession tests
// ============================================================================

describe("createFormSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a session and returns token", async () => {
    // Guest check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "guest-1" }] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow()] });

    const result = await createFormSession("guest-1");

    expect(result.session.id).toBe("session-1");
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(0);
  });

  it("uses custom expiration hours", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "guest-1" }] });
    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow()] });

    const result = await createFormSession("guest-1", 48);

    expect(result.session).toBeDefined();
    // Verify the INSERT was called with params
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("throws when guest not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(createFormSession("nonexistent")).rejects.toThrow(
      "Guest not found"
    );
  });

  it("uses provided client for transactional use", async () => {
    const client = makeMockClient();
    // Guest check
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "guest-1" }] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow()] });

    const result = await createFormSession("guest-1", 720, client as never);

    expect(result.session.id).toBe("session-1");
    // All queries went through the same mock (client.query)
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// invalidateSession tests
// ============================================================================

describe("invalidateSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when session is invalidated", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await invalidateSession("session-1");

    expect(result).toBe(true);
  });

  it("returns false when session not found or already expired", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await invalidateSession("nonexistent");

    expect(result).toBe(false);
  });
});

// ============================================================================
// getSessionByTokenHash tests
// ============================================================================

describe("getSessionByTokenHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session for valid hash", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow()] });

    const session = await getSessionByTokenHash("abc123hash");

    expect(session).not.toBeNull();
    expect(session!.id).toBe("session-1");
  });

  it("returns null for invalid hash", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const session = await getSessionByTokenHash("badhash");

    expect(session).toBeNull();
  });
});

// ============================================================================
// getSessionsForGuest tests
// ============================================================================

describe("getSessionsForGuest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all sessions for a guest", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeSessionRow({ id: "s-1", status: "active" }),
        makeSessionRow({ id: "s-2", status: "submitted" }),
      ],
    });

    const sessions = await getSessionsForGuest("guest-1");

    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe("s-1");
    expect(sessions[1].id).toBe("s-2");
  });

  it("returns empty array when no sessions exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const sessions = await getSessionsForGuest("guest-no-sessions");

    expect(sessions).toEqual([]);
  });
});

// ============================================================================
// getFormPrefill tests
// ============================================================================

describe("getFormPrefill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges guest data and registry data", async () => {
    // Guest record
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: "guest-1",
        name: "Alice",
        email: "alice@example.com",
        phone: null,
        company: "Acme",
        department: "Music",
        type: "JP",
        properties: { shirt_size: "M" },
      }],
    });
    // Registry
    mockQuery.mockResolvedValueOnce({
      rows: [{
        dietary: "vegetarian",
        travel_prefs: { airline: "JAL", seat_preference: "aisle" },
        properties: { hotel_pref: "Marriott" },
      }],
    });

    const prefill = await getFormPrefill("guest-1");

    // Guest data takes priority
    expect(prefill.guest.name).toBe("Alice");
    expect(prefill.guest.company).toBe("Acme");
    expect(prefill.guest.shirt_size).toBe("M");

    // Registry data
    expect(prefill.registry.dietary).toBe("vegetarian");
    expect(prefill.registry.airline).toBe("JAL");
    expect(prefill.registry.hotel_pref).toBe("Marriott");

    // Merged: guest overrides registry
    expect(prefill.merged.name).toBe("Alice");
    expect(prefill.merged.dietary).toBe("vegetarian");
    expect(prefill.merged.airline).toBe("JAL");
    expect(prefill.merged.shirt_size).toBe("M");
  });

  it("returns only guest data when no registry match", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "g-1", name: "Bob", email: null, phone: null, company: null, department: null, type: "NA", properties: {} }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No registry

    const prefill = await getFormPrefill("g-1");

    expect(prefill.guest.name).toBe("Bob");
    expect(prefill.registry).toEqual({});
    expect(prefill.merged.name).toBe("Bob");
  });

  it("returns empty when guest not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const prefill = await getFormPrefill("nonexistent");

    expect(prefill.guest).toEqual({});
    expect(prefill.registry).toEqual({});
    expect(prefill.merged).toEqual({});
  });

  it("guest properties override registry properties with same key", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "g-1", name: "Carol", email: null, phone: null, company: null, department: null, type: null, properties: { dietary: "keto" } }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ dietary: "vegetarian", travel_prefs: {}, properties: {} }],
    });

    const prefill = await getFormPrefill("g-1");

    // Guest has dietary=keto in properties, registry has dietary=vegetarian
    // Guest data should win in merged
    expect(prefill.merged.dietary).toBe("keto");
  });
});

// ============================================================================
// submitForm tests
// ============================================================================

describe("submitForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits form and updates guest + session", async () => {
    const client = makeMockClient();

    // Session lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow()] });
    // UPDATE session
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // UPDATE guest
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // UPDATE registry (dietary update)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await submitForm(
      "session-1",
      { dietary: "gluten-free", airline: "Delta" },
      client as never
    );

    expect(result.sessionId).toBe("session-1");
    expect(result.guestId).toBe("guest-1");
    expect(result.status).toBe("submitted");
    expect(result.submittedAt).toBeDefined();
  });

  it("merges existing form_data with new submission", async () => {
    const client = makeMockClient();
    const sessionWithData = makeSessionRow({
      form_data: { dietary: "vegan", bio: "Previous bio" },
    });

    mockQuery.mockResolvedValueOnce({ rows: [sessionWithData] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE session
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE guest
    // No registry update needed (no dietary/travel changes)

    const result = await submitForm(
      "session-1",
      { bio: "Updated bio" },
      client as never
    );

    expect(result.status).toBe("submitted");

    // Verify the merged data was sent to session update
    const sessionUpdateCall = mockQuery.mock.calls[1];
    const mergedJson = sessionUpdateCall[1][0] as string;
    const parsed = JSON.parse(mergedJson);
    expect(parsed.dietary).toBe("vegan"); // preserved from existing
    expect(parsed.bio).toBe("Updated bio"); // new value
  });

  it("throws when session not found", async () => {
    const client = makeMockClient();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      submitForm("nonexistent", {}, client as never)
    ).rejects.toThrow("Form session not found");
  });

  it("throws when form already submitted", async () => {
    const client = makeMockClient();
    mockQuery.mockResolvedValueOnce({
      rows: [makeSessionRow({ status: "submitted" })],
    });

    await expect(
      submitForm("session-1", {}, client as never)
    ).rejects.toThrow("already been submitted");
  });

  it("throws when form session expired", async () => {
    const client = makeMockClient();
    mockQuery.mockResolvedValueOnce({
      rows: [makeSessionRow({ status: "expired" })],
    });

    await expect(
      submitForm("session-1", {}, client as never)
    ).rejects.toThrow("expired");
  });

  it("updates registry with dietary and travel prefs", async () => {
    const client = makeMockClient();

    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow({ form_data: {} })] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE session
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE guest
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE registry

    await submitForm(
      "session-1",
      { dietary: "halal", carrier: "United", departure_city: "LAX" },
      client as never
    );

    // The 4th call should be the registry update
    expect(mockQuery).toHaveBeenCalledTimes(4);
    const registryCall = mockQuery.mock.calls[3];
    const sql = registryCall[0] as string;
    expect(sql).toContain("guest_registry");
    expect(sql).toContain("dietary");
    expect(sql).toContain("travel_prefs");
  });

  it("skips registry update when no persistent fields", async () => {
    const client = makeMockClient();

    mockQuery.mockResolvedValueOnce({ rows: [makeSessionRow({ form_data: {} })] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE session
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE guest

    await submitForm(
      "session-1",
      { bio: "Just a bio update" },
      client as never
    );

    // Only 3 calls — no registry update
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});
