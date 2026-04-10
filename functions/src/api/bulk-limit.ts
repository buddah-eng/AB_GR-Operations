/**
 * Bulk Operation Limit
 *
 * PRD versioning-backups §4 Layer 4: Any API call affecting 5+ records
 * requires a confirmation step. Returns 202 with a confirmation token.
 * Client must re-submit with the token to proceed.
 *
 * Threshold is configurable per concept via ontology config.
 */

import * as crypto from "crypto";
import type { Response } from "express";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface BulkConfirmation {
  readonly token: string;
  readonly conceptKey: string;
  readonly operation: string;
  readonly recordCount: number;
  readonly actorId: string;
  readonly expiresAt: Date;
}

// --- Constants ---

const DEFAULT_BULK_THRESHOLD = 5;
const TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

// In-memory store for pending confirmations (per-instance; acceptable for single-instance deployments)
const pendingConfirmations = new Map<string, BulkConfirmation>();

// --- Public API ---

/**
 * Checks whether a bulk operation needs confirmation.
 * If recordCount >= threshold, generates a confirmation token and returns it.
 * If a valid confirmation token is provided, returns null (proceed).
 */
export function checkBulkLimit(
  conceptKey: string,
  operation: string,
  recordCount: number,
  actorId: string,
  confirmationToken?: string,
  threshold: number = DEFAULT_BULK_THRESHOLD
): BulkConfirmation | null {
  // Below threshold — no confirmation needed
  if (recordCount < threshold) {
    return null;
  }

  // Confirmation token provided — validate it
  if (confirmationToken) {
    const pending = pendingConfirmations.get(confirmationToken);
    if (!pending) {
      throw Object.assign(
        new Error("Invalid or expired confirmation token"),
        { status: 400 }
      );
    }

    if (pending.expiresAt < new Date()) {
      pendingConfirmations.delete(confirmationToken);
      throw Object.assign(
        new Error("Confirmation token has expired. Please retry the operation."),
        { status: 400 }
      );
    }

    if (pending.conceptKey !== conceptKey || pending.operation !== operation) {
      throw Object.assign(
        new Error("Confirmation token does not match this operation"),
        { status: 400 }
      );
    }

    // Valid confirmation — consume the token and allow
    pendingConfirmations.delete(confirmationToken);
    logger.info("Bulk operation confirmed", {
      conceptKey,
      operation,
      recordCount,
      actorId,
    });
    return null;
  }

  // No token, above threshold — generate confirmation
  const token = crypto.randomUUID();
  const confirmation: BulkConfirmation = {
    token,
    conceptKey,
    operation,
    recordCount,
    actorId,
    expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
  };

  pendingConfirmations.set(token, confirmation);

  logger.info("Bulk operation requires confirmation", {
    conceptKey,
    operation,
    recordCount,
    actorId,
    token,
  });

  return confirmation;
}

/**
 * Sends a 202 response with confirmation token when bulk limit is exceeded.
 */
export function sendBulkConfirmationRequired(
  res: Response,
  confirmation: BulkConfirmation
): void {
  res.status(202).json({
    success: false,
    error: "bulk_limit_exceeded",
    data: {
      message: `This operation affects ${confirmation.recordCount} records. Please confirm to proceed.`,
      confirmationToken: confirmation.token,
      recordCount: confirmation.recordCount,
      expiresIn: TOKEN_EXPIRY_MS / 1000,
    },
  });
}

/**
 * Clears expired confirmations. Call periodically (or on each check).
 */
export function clearExpiredConfirmations(): void {
  const now = new Date();
  for (const [token, confirmation] of pendingConfirmations) {
    if (confirmation.expiresAt < now) {
      pendingConfirmations.delete(token);
    }
  }
}

// Exported for testing
export { pendingConfirmations as _pendingConfirmations };
