/**
 * Guest Self-Service Service
 *
 * Manages tokenized guest form sessions: creation, prefill from YoY registry
 * and existing guest data, and form submission with domain event firing.
 *
 * Token flow:
 *   1. createFormSession() — generates token, stores SHA-256 hash in DB
 *   2. getFormPrefill()    — merges registry + guest data for pre-population
 *   3. submitForm()        — validates, updates guest, updates registry, fires event
 */

import * as crypto from "crypto";
import { query } from "../db/client";
import type { PoolClient } from "pg";

// --- Types ---

export interface FormSession {
  readonly id: string;
  readonly token_hash: string;
  readonly guest_id: string;
  readonly form_data: Record<string, unknown>;
  readonly status: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly submitted_at: string | null;
  readonly last_saved_at: string | null;
}

export interface FormSessionCreateResult {
  readonly session: FormSession;
  readonly token: string;
}

export interface PrefillData {
  readonly guest: Record<string, unknown>;
  readonly registry: Record<string, unknown>;
  readonly merged: Record<string, unknown>;
}

export interface SubmitFormResult {
  readonly sessionId: string;
  readonly guestId: string;
  readonly status: string;
  readonly submittedAt: string;
}

// --- Session management ---

/**
 * Creates a new form session with a random token.
 * The raw token is returned once; only the hash is stored.
 */
export async function createFormSession(
  guestId: string,
  expiresInHours = 720, // 30 days default
  client?: PoolClient
): Promise<FormSessionCreateResult> {
  // Validate guest exists
  const guestCheck = client
    ? await client.query("SELECT id FROM guests WHERE id = $1", [guestId])
    : await query("SELECT id FROM guests WHERE id = $1", [guestId]);

  if (guestCheck.rows.length === 0) {
    throw new Error(`Guest not found: ${guestId}`);
  }

  const token = crypto.randomUUID();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const sql = `
    INSERT INTO guest_form_sessions (token_hash, guest_id, expires_at)
    VALUES ($1, $2, $3)
    RETURNING *
  `;

  const result = client
    ? await client.query(sql, [tokenHash, guestId, expiresAt.toISOString()])
    : await query(sql, [tokenHash, guestId, expiresAt.toISOString()]);

  return {
    session: rowToFormSession(result.rows[0]),
    token,
  };
}

/**
 * Invalidates an existing session by marking it expired.
 * Used when regenerating a token.
 */
export async function invalidateSession(
  sessionId: string,
  client?: PoolClient
): Promise<boolean> {
  const sql = `
    UPDATE guest_form_sessions
    SET status = 'expired', expires_at = now()
    WHERE id = $1 AND status = 'active'
  `;

  const result = client
    ? await client.query(sql, [sessionId])
    : await query(sql, [sessionId]);

  return (result.rowCount ?? 0) > 0;
}

/**
 * Looks up a session by token hash.
 * Returns null if not found or expired.
 */
export async function getSessionByTokenHash(
  tokenHash: string
): Promise<FormSession | null> {
  const result = await query(
    `SELECT * FROM guest_form_sessions
     WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash]
  );

  if (result.rows.length === 0) return null;
  return rowToFormSession(result.rows[0]);
}

/**
 * Returns all sessions for a guest.
 */
export async function getSessionsForGuest(
  guestId: string
): Promise<ReadonlyArray<FormSession>> {
  const result = await query(
    `SELECT * FROM guest_form_sessions
     WHERE guest_id = $1
     ORDER BY created_at DESC`,
    [guestId]
  );
  return result.rows.map(rowToFormSession);
}

// --- Prefill ---

/**
 * Merges guest record data and YoY registry data for form pre-population.
 * Priority: existing guest data > registry data.
 */
export async function getFormPrefill(guestId: string): Promise<PrefillData> {
  // Fetch guest record
  const guestResult = await query(
    `SELECT id, name, type, department, email, phone, company, properties
     FROM guests WHERE id = $1 AND NOT archived`,
    [guestId]
  );

  const guestData: Record<string, unknown> = {};
  if (guestResult.rows.length > 0) {
    const guest = guestResult.rows[0];
    if (guest.name) guestData.name = guest.name;
    if (guest.email) guestData.email = guest.email;
    if (guest.phone) guestData.phone = guest.phone;
    if (guest.company) guestData.company = guest.company;
    if (guest.department) guestData.department = guest.department;
    if (guest.type) guestData.type = guest.type;
    const guestProps = (guest.properties ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(guestProps)) {
      if (v !== null && v !== undefined) {
        guestData[k] = v;
      }
    }
  }

  // Fetch YoY registry data
  const registryResult = await query(
    `SELECT gr.dietary, gr.travel_prefs, gr.properties
     FROM guest_registry gr
     JOIN guests g ON g.registry_id = gr.id
     WHERE g.id = $1`,
    [guestId]
  );

  const registryData: Record<string, unknown> = {};
  if (registryResult.rows.length > 0) {
    const registry = registryResult.rows[0];
    if (registry.dietary) registryData.dietary = registry.dietary;

    const travelPrefs = (registry.travel_prefs ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(travelPrefs)) {
      if (v !== null && v !== undefined) {
        registryData[k] = v;
      }
    }

    const regProps = (registry.properties ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(regProps)) {
      if (v !== null && v !== undefined) {
        registryData[k] = v;
      }
    }
  }

  // Merge: guest data takes priority over registry data
  const merged = { ...registryData, ...guestData };

  return { guest: guestData, registry: registryData, merged };
}

// --- Submission ---

/**
 * Submits a guest form session:
 * 1. Validates session is active
 * 2. Updates guest record with form data
 * 3. Updates registry with persistent prefs (dietary, travel_prefs)
 * 4. Marks session as submitted
 *
 * Returns the submission result. The caller is responsible for
 * firing the domain event (to keep the service layer pure).
 */
export async function submitForm(
  sessionId: string,
  formData: Record<string, unknown>,
  client: PoolClient
): Promise<SubmitFormResult> {
  // Fetch session
  const sessionResult = await client.query(
    "SELECT * FROM guest_form_sessions WHERE id = $1",
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    throw new Error(`Form session not found: ${sessionId}`);
  }

  const session = rowToFormSession(sessionResult.rows[0]);

  if (session.status === "submitted") {
    throw new Error("Form has already been submitted.");
  }

  if (session.status === "expired") {
    throw new Error("Form session has expired.");
  }

  // Check expiration
  if (new Date(session.expires_at) < new Date()) {
    throw new Error("Form session has expired.");
  }

  // Merge existing form_data with new submission
  const mergedData = { ...session.form_data, ...formData };

  // 1. Mark session as submitted
  await client.query(
    `UPDATE guest_form_sessions
     SET status = 'submitted',
         form_data = $1::jsonb,
         submitted_at = now(),
         last_saved_at = now()
     WHERE id = $2`,
    [JSON.stringify(mergedData), sessionId]
  );

  // 2. Update guest record
  await client.query(
    `UPDATE guests
     SET properties = properties || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(mergedData), session.guest_id]
  );

  // 3. Update registry with persistent preferences
  const registryUpdates: Record<string, unknown> = {};
  if (mergedData.dietary !== undefined) {
    registryUpdates.dietary = mergedData.dietary;
  }

  const travelFields = ["airline", "carrier", "departure_city", "seat_preference"];
  const travelPrefs: Record<string, unknown> = {};
  for (const field of travelFields) {
    if (mergedData[field] !== undefined) {
      travelPrefs[field] = mergedData[field];
    }
  }

  if (Object.keys(registryUpdates).length > 0 || Object.keys(travelPrefs).length > 0) {
    const setClauses: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (registryUpdates.dietary !== undefined) {
      setClauses.push(`dietary = $${paramIdx++}`);
      params.push(registryUpdates.dietary);
    }

    if (Object.keys(travelPrefs).length > 0) {
      setClauses.push(`travel_prefs = travel_prefs || $${paramIdx++}::jsonb`);
      params.push(JSON.stringify(travelPrefs));
    }

    params.push(session.guest_id);

    await client.query(
      `UPDATE guest_registry gr
       SET ${setClauses.join(", ")}
       FROM guests g
       WHERE g.registry_id = gr.id AND g.id = $${paramIdx}`,
      params
    );
  }

  const now = new Date().toISOString();

  return {
    sessionId,
    guestId: session.guest_id,
    status: "submitted",
    submittedAt: now,
  };
}

// --- Helpers ---

function rowToFormSession(row: Record<string, unknown>): FormSession {
  return {
    id: row.id as string,
    token_hash: row.token_hash as string,
    guest_id: row.guest_id as string,
    form_data: (row.form_data as Record<string, unknown>) ?? {},
    status: (row.status as string) ?? "active",
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : (row.created_at as string) ?? new Date().toISOString(),
    expires_at: row.expires_at instanceof Date
      ? row.expires_at.toISOString()
      : (row.expires_at as string) ?? new Date().toISOString(),
    submitted_at: row.submitted_at
      ? row.submitted_at instanceof Date
        ? row.submitted_at.toISOString()
        : (row.submitted_at as string)
      : null,
    last_saved_at: row.last_saved_at
      ? row.last_saved_at instanceof Date
        ? row.last_saved_at.toISOString()
        : (row.last_saved_at as string)
      : null,
  };
}

// Exported for testing
export { rowToFormSession };
