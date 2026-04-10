/**
 * Notification Service
 *
 * Delivers notifications through multiple channels (email, in-app, push).
 * Subscribes to the event bus at priority 900 and handles notification.requested events.
 * Supports recipient resolution by role, user ID, or department.
 * Renders templates from the unified templates table with {{variable}} replacement.
 */

import * as logger from "firebase-functions/logger";
import { subscribe } from "../events/bus";
import { query } from "../db/client";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface NotificationRequest {
  readonly recipientSpec: string;
  readonly templateName?: string;
  readonly subject?: string;
  readonly body?: string;
  readonly channel?: NotificationChannel;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly context?: Readonly<Record<string, unknown>>;
}

export type NotificationChannel = "email" | "in_app" | "push";

export interface NotificationRecord {
  readonly id: string;
  readonly recipient_id: string;
  readonly channel: NotificationChannel;
  readonly template_name: string | null;
  readonly subject: string | null;
  readonly body: string | null;
  readonly status: string;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly sent_at: string | null;
  readonly read_at: string | null;
}

export interface NotificationPreferences {
  readonly id: string;
  readonly user_id: string;
  readonly channel_email: boolean;
  readonly channel_in_app: boolean;
  readonly quiet_hours_start: string | null;
  readonly quiet_hours_end: string | null;
  readonly digest_mode: "none" | "hourly" | "daily";
}

export interface UpdatePreferencesData {
  readonly channel_email?: boolean;
  readonly channel_in_app?: boolean;
  readonly quiet_hours_start?: string | null;
  readonly quiet_hours_end?: string | null;
  readonly digest_mode?: "none" | "hourly" | "daily";
}

export interface NotificationFilters {
  readonly status?: string;
  readonly channel?: NotificationChannel;
  readonly limit?: number;
  readonly offset?: number;
}

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
  readonly role_key?: string;
  readonly department?: string;
}

export interface ServiceResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

// --- Injected email provider (for testing) ---

export type EmailProvider = (
  to: string,
  subject: string,
  body: string
) => Promise<void>;

let _emailProvider: EmailProvider = defaultEmailProvider;

export function setEmailProvider(provider: EmailProvider): void {
  _emailProvider = provider;
}

export function resetEmailProvider(): void {
  _emailProvider = defaultEmailProvider;
}

async function defaultEmailProvider(
  to: string,
  subject: string,
  _body: string
): Promise<void> {
  logger.info("Email delivery (log-only)", { to, subject });
}

// --- Registration ---

/**
 * Subscribes to notification.requested events at priority 900.
 * Returns an unsubscribe function.
 */
export function registerNotificationHandler(): () => void {
  return subscribe(
    "notification.requested",
    handleNotificationRequest,
    900
  );
}

// --- Event handler ---

async function handleNotificationRequest(event: DomainEvent): Promise<void> {
  const request = event.metadata as unknown as NotificationRequest | undefined;
  if (!request) {
    logger.warn("notification.requested event missing metadata");
    return;
  }

  const recipients = await resolveRecipients(request.recipientSpec);
  if (recipients.length === 0) {
    logger.warn("No recipients resolved", { spec: request.recipientSpec });
    return;
  }

  let subject = request.subject ?? "";
  let body = request.body ?? "";

  if (request.templateName) {
    const rendered = await renderTemplate(
      request.templateName,
      request.context ?? {}
    );
    if (rendered) {
      subject = rendered.subject;
      body = rendered.body;
    }
  }

  const channel = request.channel ?? "in_app";

  for (const recipient of recipients) {
    try {
      if (channel === "email") {
        await deliverEmail(recipient.email, subject, body);
      }
      if (channel === "in_app" || channel === "email") {
        await deliverInApp(recipient.id, subject, body, request.metadata ?? {});
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Notification delivery failed", {
        recipientId: recipient.id,
        channel,
        error: message,
      });
    }
  }
}

// --- Recipient resolution ---

/**
 * Resolves a recipient specification to a list of user records.
 *
 * Supported formats:
 *   "user:<uuid>"        — single user by ID
 *   "role:<role_key>"    — all users with the given role
 *   "department:<name>"  — all users in the given department
 */
export async function resolveRecipients(
  recipientSpec: string
): Promise<ReadonlyArray<UserRecord>> {
  const [type, value] = recipientSpec.split(":");

  if (!type || !value) {
    logger.warn("Invalid recipient spec", { recipientSpec });
    return [];
  }

  switch (type) {
    case "user": {
      const result = await query(
        "SELECT id, email, name, role_key, department FROM users WHERE id = $1 AND active = true",
        [value]
      );
      return result.rows as unknown as UserRecord[];
    }

    case "role": {
      const result = await query(
        "SELECT id, email, name, role_key, department FROM users WHERE role_key = $1 AND active = true",
        [value]
      );
      return result.rows as unknown as UserRecord[];
    }

    case "department": {
      const result = await query(
        "SELECT id, email, name, role_key, department FROM users WHERE department = $1 AND active = true",
        [value]
      );
      return result.rows as unknown as UserRecord[];
    }

    default:
      logger.warn("Unknown recipient type", { type });
      return [];
  }
}

// --- Template rendering ---

/**
 * Loads a notification template by name and replaces {{variables}} with context values.
 */
export async function renderTemplate(
  templateName: string,
  context: Readonly<Record<string, unknown>>
): Promise<{ subject: string; body: string } | null> {
  const result = await query(
    "SELECT content FROM templates WHERE name = $1 AND template_type = 'notification' AND status = 'active' LIMIT 1",
    [templateName]
  );

  if (result.rows.length === 0) {
    logger.warn("Notification template not found", { templateName });
    return null;
  }

  const content = result.rows[0].content as Record<string, unknown>;
  const rawSubject = (content.subject as string) ?? "";
  const rawBody = (content.body as string) ?? "";

  return {
    subject: replaceVariables(rawSubject, context),
    body: replaceVariables(rawBody, context),
  };
}

/**
 * Replaces {{variable}} placeholders with values from the context object.
 */
export function replaceVariables(
  template: string,
  context: Readonly<Record<string, unknown>>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = context[key];
    return value !== undefined && value !== null ? String(value) : "";
  });
}

// --- Delivery ---

/**
 * Sends an email via the injected email provider.
 */
export async function deliverEmail(
  to: string,
  subject: string,
  body: string
): Promise<void> {
  await _emailProvider(to, subject, body);
}

/**
 * Creates an in-app notification by inserting into notification_log.
 */
export async function deliverInApp(
  userId: string,
  subject: string,
  body: string,
  metadata: Readonly<Record<string, unknown>>
): Promise<ServiceResult<NotificationRecord>> {
  const result = await query(
    `INSERT INTO notification_log (recipient_id, channel, subject, body, status, metadata, sent_at)
     VALUES ($1, 'in_app', $2, $3, 'sent', $4, now())
     RETURNING *`,
    [userId, subject, body, JSON.stringify(metadata)]
  );

  return {
    success: true,
    data: result.rows[0] as unknown as NotificationRecord,
  };
}

// --- Query ---

/**
 * Lists in-app notifications for a user with optional filters.
 */
export async function getNotifications(
  userId: string,
  filters?: NotificationFilters
): Promise<ServiceResult<ReadonlyArray<NotificationRecord>>> {
  const conditions: string[] = [
    "recipient_id = $1",
    "channel = 'in_app'",
  ];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (filters?.status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(filters.status);
  }

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  const whereClause = conditions.join(" AND ");
  const result = await query(
    `SELECT * FROM notification_log
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return {
    success: true,
    data: result.rows as unknown as NotificationRecord[],
  };
}

/**
 * Marks a notification as read.
 */
export async function markAsRead(
  notificationId: string
): Promise<ServiceResult<NotificationRecord>> {
  const result = await query(
    `UPDATE notification_log
     SET status = 'read', read_at = now()
     WHERE id = $1
     RETURNING *`,
    [notificationId]
  );

  if (result.rows.length === 0) {
    return { success: false, error: "Notification not found" };
  }

  return {
    success: true,
    data: result.rows[0] as unknown as NotificationRecord,
  };
}

/**
 * Returns the count of unread in-app notifications for a user.
 */
export async function getUnreadCount(
  userId: string
): Promise<ServiceResult<number>> {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM notification_log
     WHERE recipient_id = $1 AND channel = 'in_app' AND status != 'read'`,
    [userId]
  );

  return {
    success: true,
    data: (result.rows[0] as { count: number }).count,
  };
}

// --- Preferences ---

/**
 * Gets notification preferences for a user.
 */
export async function getPreferences(
  userId: string
): Promise<ServiceResult<NotificationPreferences | null>> {
  const result = await query(
    "SELECT * FROM notification_preferences WHERE user_id = $1",
    [userId]
  );

  return {
    success: true,
    data: (result.rows[0] as unknown as NotificationPreferences) ?? null,
  };
}

/**
 * Creates or updates notification preferences for a user.
 */
export async function updatePreferences(
  userId: string,
  prefs: UpdatePreferencesData
): Promise<ServiceResult<NotificationPreferences>> {
  const result = await query(
    `INSERT INTO notification_preferences (user_id, channel_email, channel_in_app, quiet_hours_start, quiet_hours_end, digest_mode)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       channel_email = COALESCE($2, notification_preferences.channel_email),
       channel_in_app = COALESCE($3, notification_preferences.channel_in_app),
       quiet_hours_start = $4,
       quiet_hours_end = $5,
       digest_mode = COALESCE($6, notification_preferences.digest_mode)
     RETURNING *`,
    [
      userId,
      prefs.channel_email ?? true,
      prefs.channel_in_app ?? true,
      prefs.quiet_hours_start ?? null,
      prefs.quiet_hours_end ?? null,
      prefs.digest_mode ?? "none",
    ]
  );

  return {
    success: true,
    data: result.rows[0] as unknown as NotificationPreferences,
  };
}
