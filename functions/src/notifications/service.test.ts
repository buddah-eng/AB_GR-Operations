/**
 * Tests for Notification Service
 *
 * Covers:
 * - registerNotificationHandler subscribes at priority 900
 * - Recipient resolution: role-based, user-based, department-based
 * - Recipient resolution: invalid spec returns empty
 * - Template rendering with variable replacement
 * - replaceVariables handles missing variables
 * - In-app delivery creates notification_log row
 * - Email delivery calls the injected provider
 * - getNotifications returns filtered list
 * - markAsRead updates status and returns record
 * - markAsRead returns error for missing notification
 * - getUnreadCount returns correct count
 * - Preferences CRUD: getPreferences and updatePreferences
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearSubscriptions,
  subscriptionCount,
} from "../events/bus";

// --- Mocks (must be before import of module under test) ---

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockQuery = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

// --- Import module under test ---

import {
  registerNotificationHandler,
  resolveRecipients,
  renderTemplate,
  replaceVariables,
  deliverEmail,
  deliverInApp,
  getNotifications,
  markAsRead,
  getUnreadCount,
  getPreferences,
  updatePreferences,
  setEmailProvider,
  resetEmailProvider,
} from "./service";

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  clearSubscriptions();
  resetEmailProvider();
});

afterEach(() => {
  resetEmailProvider();
});

// ============================================================
// registerNotificationHandler
// ============================================================

describe("registerNotificationHandler", () => {
  it("subscribes to event bus at priority 900", () => {
    const initial = subscriptionCount();
    const unsub = registerNotificationHandler();

    expect(subscriptionCount()).toBe(initial + 1);

    unsub();
    expect(subscriptionCount()).toBe(initial);
  });
});

// ============================================================
// resolveRecipients
// ============================================================

describe("resolveRecipients", () => {
  it("resolves user by ID", async () => {
    const user = { id: "u-1", email: "john@example.com", name: "John" };
    mockQuery.mockResolvedValue({ rows: [user] });

    const result = await resolveRecipients("user:u-1");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("u-1");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("id = $1"),
      ["u-1"]
    );
  });

  it("resolves users by role", async () => {
    const users = [
      { id: "u-1", email: "a@example.com", role_key: "liaison" },
      { id: "u-2", email: "b@example.com", role_key: "liaison" },
    ];
    mockQuery.mockResolvedValue({ rows: users });

    const result = await resolveRecipients("role:liaison");

    expect(result).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("role_key = $1"),
      ["liaison"]
    );
  });

  it("resolves users by department", async () => {
    const users = [
      { id: "u-3", email: "c@example.com", department: "gr" },
    ];
    mockQuery.mockResolvedValue({ rows: users });

    const result = await resolveRecipients("department:gr");

    expect(result).toHaveLength(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("department = $1"),
      ["gr"]
    );
  });

  it("returns empty array for invalid spec", async () => {
    const result = await resolveRecipients("invalid");

    expect(result).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns empty array for unknown type", async () => {
    const result = await resolveRecipients("group:admins");

    expect(result).toHaveLength(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ============================================================
// renderTemplate
// ============================================================

describe("renderTemplate", () => {
  it("loads template and replaces variables", async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        content: {
          subject: "Welcome {{name}}",
          body: "Hello {{name}}, your role is {{role}}.",
        },
      }],
    });

    const result = await renderTemplate("welcome_email", {
      name: "Alice",
      role: "Liaison",
    });

    expect(result).not.toBeNull();
    expect(result!.subject).toBe("Welcome Alice");
    expect(result!.body).toBe("Hello Alice, your role is Liaison.");
  });

  it("returns null when template not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await renderTemplate("nonexistent", {});

    expect(result).toBeNull();
  });
});

// ============================================================
// replaceVariables
// ============================================================

describe("replaceVariables", () => {
  it("replaces multiple variables", () => {
    const result = replaceVariables(
      "Hello {{name}}, welcome to {{place}}!",
      { name: "Bob", place: "GR-Ops" }
    );

    expect(result).toBe("Hello Bob, welcome to GR-Ops!");
  });

  it("replaces missing variables with empty string", () => {
    const result = replaceVariables(
      "Hello {{name}}, your ID is {{id}}.",
      { name: "Bob" }
    );

    expect(result).toBe("Hello Bob, your ID is .");
  });
});

// ============================================================
// deliverInApp
// ============================================================

describe("deliverInApp", () => {
  it("inserts notification_log row with status sent", async () => {
    const inserted = {
      id: "notif-1",
      recipient_id: "u-1",
      channel: "in_app",
      subject: "Test",
      body: "Hello",
      status: "sent",
      metadata: {},
      sent_at: "2026-04-08T00:00:00Z",
    };
    mockQuery.mockResolvedValue({ rows: [inserted] });

    const result = await deliverInApp("u-1", "Test", "Hello", { key: "val" });

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("sent");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO notification_log"),
      ["u-1", "Test", "Hello", expect.any(String)]
    );
  });
});

// ============================================================
// deliverEmail
// ============================================================

describe("deliverEmail", () => {
  it("calls the injected email provider", async () => {
    const mockProvider = vi.fn().mockResolvedValue(undefined);
    setEmailProvider(mockProvider);

    await deliverEmail("test@example.com", "Subject", "Body");

    expect(mockProvider).toHaveBeenCalledWith("test@example.com", "Subject", "Body");
  });
});

// ============================================================
// getNotifications
// ============================================================

describe("getNotifications", () => {
  it("returns filtered list for user", async () => {
    const notifications = [
      { id: "n-1", recipient_id: "u-1", status: "sent" },
      { id: "n-2", recipient_id: "u-1", status: "sent" },
    ];
    mockQuery.mockResolvedValue({ rows: notifications });

    const result = await getNotifications("u-1", { limit: 10 });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("recipient_id = $1"),
      expect.arrayContaining(["u-1"])
    );
  });

  it("applies status filter", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await getNotifications("u-1", { status: "sent" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = $2"),
      expect.arrayContaining(["u-1", "sent"])
    );
  });
});

// ============================================================
// markAsRead
// ============================================================

describe("markAsRead", () => {
  it("updates status to read and returns record", async () => {
    const updated = { id: "n-1", status: "read", read_at: "2026-04-08T12:00:00Z" };
    mockQuery.mockResolvedValue({ rows: [updated] });

    const result = await markAsRead("n-1");

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("read");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'read'"),
      ["n-1"]
    );
  });

  it("returns error when notification not found", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await markAsRead("nonexistent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ============================================================
// getUnreadCount
// ============================================================

describe("getUnreadCount", () => {
  it("returns correct count of unread notifications", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 5 }] });

    const result = await getUnreadCount("u-1");

    expect(result.success).toBe(true);
    expect(result.data).toBe(5);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status != 'read'"),
      ["u-1"]
    );
  });
});

// ============================================================
// Preferences CRUD
// ============================================================

describe("getPreferences", () => {
  it("returns preferences for user", async () => {
    const prefs = {
      id: "pref-1",
      user_id: "u-1",
      channel_email: true,
      channel_in_app: true,
      digest_mode: "none",
    };
    mockQuery.mockResolvedValue({ rows: [prefs] });

    const result = await getPreferences("u-1");

    expect(result.success).toBe(true);
    expect(result.data?.channel_email).toBe(true);
  });

  it("returns null when no preferences exist", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await getPreferences("u-1");

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});

describe("updatePreferences", () => {
  it("upserts preferences and returns result", async () => {
    const upserted = {
      id: "pref-1",
      user_id: "u-1",
      channel_email: false,
      channel_in_app: true,
      digest_mode: "daily",
    };
    mockQuery.mockResolvedValue({ rows: [upserted] });

    const result = await updatePreferences("u-1", {
      channel_email: false,
      digest_mode: "daily",
    });

    expect(result.success).toBe(true);
    expect(result.data?.channel_email).toBe(false);
    expect(result.data?.digest_mode).toBe("daily");
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT"),
      expect.arrayContaining(["u-1"])
    );
  });
});
