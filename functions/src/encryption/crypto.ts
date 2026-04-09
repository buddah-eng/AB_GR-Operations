/**
 * Column-Level PII Encryption
 *
 * AES-256-GCM application-layer encryption for sensitive fields.
 * Key stored in environment variable (GCP Secret Manager in production).
 * Decrypt only after RBAC field filtering — if a role can't see the field,
 * decryption never runs.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import * as logger from "firebase-functions/logger";

// --- Types ---

export interface EncryptedField {
  readonly iv: string;      // base64-encoded 12-byte IV
  readonly data: string;    // base64-encoded ciphertext
  readonly tag: string;     // base64-encoded auth tag
  readonly keyVersion: number;
}

// --- Key management ---

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
      "Set it via environment variable."
    );
  }

  cachedKey = Buffer.from(keyHex, "hex");
  return cachedKey;
}

function getCurrentKeyVersion(): number {
  return parseInt(process.env.ENCRYPTION_KEY_VERSION ?? "1", 10);
}

// --- Encryption ---

export function encrypt(plaintext: string): EncryptedField {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    data: encrypted.toString("base64"),
    tag: authTag.toString("base64"),
    keyVersion: getCurrentKeyVersion(),
  };
}

// --- Decryption ---

export function decrypt(field: EncryptedField): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(field.iv, "base64");
  const encryptedData = Buffer.from(field.data, "base64");
  const authTag = Buffer.from(field.tag, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

// --- Field helpers ---

const PII_FIELDS = new Set([
  "email", "phone", "emergency_contact", "passport_number",
  "visa_details", "hotel_room", "home_address", "dietary_restrictions",
  "flight_details", "driver_phone", "compensation",
]);

export function isPiiField(fieldKey: string): boolean {
  return PII_FIELDS.has(fieldKey);
}

/**
 * Returns true if the encryption key is configured.
 * When false, encrypt/decrypt operations are skipped (dev/test environments).
 */
export function isEncryptionConfigured(): boolean {
  const keyHex = process.env.ENCRYPTION_KEY;
  return typeof keyHex === "string" && keyHex.length === 64;
}

/**
 * Encrypts PII fields in a record before writing to Postgres.
 * Non-PII fields pass through unchanged.
 */
export function encryptPiiFields(
  record: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isPiiField(key) && typeof value === "string" && value.length > 0) {
      result[key] = encrypt(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Decrypts PII fields in a record after reading from Postgres.
 * Handles both encrypted (EncryptedField object) and plaintext values gracefully.
 */
export function decryptPiiFields(
  record: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (isPiiField(key) && isEncryptedField(value)) {
      try {
        result[key] = decrypt(value);
      } catch (err) {
        logger.error(`Failed to decrypt field "${key}"`, { error: err });
        result[key] = "[ENCRYPTED]";
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isEncryptedField(value: unknown): value is EncryptedField {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.iv === "string" &&
    typeof obj.data === "string" &&
    typeof obj.tag === "string" &&
    typeof obj.keyVersion === "number"
  );
}
