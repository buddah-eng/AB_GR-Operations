import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  encrypt,
  decrypt,
  isPiiField,
  isEncryptionConfigured,
  encryptPiiFields,
  decryptPiiFields,
  computeHmac,
  isHmacConfigured,
  reEncryptField,
  logDecryption,
} from "./crypto";

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Set a test encryption key (32 bytes = 64 hex chars)
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_HMAC_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

describe("Encryption Module", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
    process.env.ENCRYPTION_KEY_VERSION = "1";
    process.env.HMAC_KEY = TEST_HMAC_KEY;
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_VERSION;
    delete process.env.HMAC_KEY;
  });

  describe("isEncryptionConfigured", () => {
    it("returns true when ENCRYPTION_KEY is a 64-char hex string", () => {
      expect(isEncryptionConfigured()).toBe(true);
    });

    it("returns false when ENCRYPTION_KEY is not set", () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      expect(isEncryptionConfigured()).toBe(false);
      process.env.ENCRYPTION_KEY = saved;
    });

    it("returns false when ENCRYPTION_KEY is too short", () => {
      const saved = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = "tooshort";
      expect(isEncryptionConfigured()).toBe(false);
      process.env.ENCRYPTION_KEY = saved;
    });
  });

  describe("encrypt / decrypt roundtrip", () => {
    it("encrypts and decrypts a string correctly", () => {
      const plaintext = "sensitive-email@example.com";
      const encrypted = encrypt(plaintext);

      expect(encrypted.iv).toBeDefined();
      expect(encrypted.data).toBeDefined();
      expect(encrypted.tag).toBeDefined();
      expect(encrypted.keyVersion).toBe(1);
      expect(encrypted.data).not.toBe(plaintext);

      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertext for the same plaintext (random IV)", () => {
      const plaintext = "same-text-twice";
      const enc1 = encrypt(plaintext);
      const enc2 = encrypt(plaintext);

      expect(enc1.data).not.toBe(enc2.data);
      expect(enc1.iv).not.toBe(enc2.iv);

      expect(decrypt(enc1)).toBe(plaintext);
      expect(decrypt(enc2)).toBe(plaintext);
    });

    it("handles unicode correctly", () => {
      const plaintext = "田中太郎 tanaka@example.jp";
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it("handles empty string", () => {
      const encrypted = encrypt("");
      expect(decrypt(encrypted)).toBe("");
    });
  });

  describe("isPiiField", () => {
    it("identifies PII fields", () => {
      expect(isPiiField("email")).toBe(true);
      expect(isPiiField("phone")).toBe(true);
      expect(isPiiField("passport_number")).toBe(true);
      expect(isPiiField("dietary_restrictions")).toBe(true);
      expect(isPiiField("compensation")).toBe(true);
    });

    it("does not flag non-PII fields", () => {
      expect(isPiiField("name")).toBe(false);
      expect(isPiiField("status")).toBe(false);
      expect(isPiiField("department")).toBe(false);
      expect(isPiiField("type")).toBe(false);
    });
  });

  describe("encryptPiiFields", () => {
    it("encrypts only PII fields, leaves others unchanged", () => {
      const record = {
        name: "Tanaka Yuki",
        email: "tanaka@example.com",
        phone: "+81-90-1234-5678",
        status: "confirmed",
        department: "Anime",
      };

      const encrypted = encryptPiiFields(record);

      // Non-PII fields unchanged
      expect(encrypted.name).toBe("Tanaka Yuki");
      expect(encrypted.status).toBe("confirmed");
      expect(encrypted.department).toBe("Anime");

      // PII fields are encrypted objects
      expect(typeof encrypted.email).toBe("object");
      expect((encrypted.email as { iv: string }).iv).toBeDefined();
      expect(typeof encrypted.phone).toBe("object");
      expect((encrypted.phone as { iv: string }).iv).toBeDefined();
    });

    it("skips PII fields with non-string or empty values", () => {
      const record = {
        email: "",
        phone: null,
        name: "Test",
      };

      const encrypted = encryptPiiFields(record);
      expect(encrypted.email).toBe("");
      expect(encrypted.phone).toBe(null);
    });
  });

  describe("decryptPiiFields", () => {
    it("decrypts encrypted PII fields", () => {
      const original = {
        name: "Tanaka",
        email: "tanaka@example.com",
        phone: "+81-90-1234-5678",
        status: "confirmed",
      };

      const encrypted = encryptPiiFields(original);
      const decrypted = decryptPiiFields(encrypted);

      expect(decrypted.name).toBe("Tanaka");
      expect(decrypted.email).toBe("tanaka@example.com");
      expect(decrypted.phone).toBe("+81-90-1234-5678");
      expect(decrypted.status).toBe("confirmed");
    });

    it("passes through plaintext PII fields gracefully (migration case)", () => {
      const record = {
        email: "plaintext@example.com",
        name: "Test",
      };

      const decrypted = decryptPiiFields(record);
      expect(decrypted.email).toBe("plaintext@example.com");
    });

    it("returns [ENCRYPTED] for corrupted encrypted fields", () => {
      const record = {
        email: { iv: "bad", data: "bad", tag: "bad", keyVersion: 1 },
        name: "Test",
      };

      const decrypted = decryptPiiFields(record);
      expect(decrypted.email).toBe("[ENCRYPTED]");
      expect(decrypted.name).toBe("Test");
    });
  });

  // --- Section 5: Blind Index (HMAC) ---

  describe("computeHmac", () => {
    it("produces consistent hash for same input", () => {
      const hash1 = computeHmac("user@example.com");
      const hash2 = computeHmac("user@example.com");
      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different inputs", () => {
      const hash1 = computeHmac("alice@example.com");
      const hash2 = computeHmac("bob@example.com");
      expect(hash1).not.toBe(hash2);
    });

    it("is deterministic with the same key", () => {
      const value = "deterministic-test@example.com";
      const results = Array.from({ length: 5 }, () => computeHmac(value));
      const allSame = results.every((r) => r === results[0]);
      expect(allSame).toBe(true);
      expect(results[0]).toHaveLength(64); // SHA-256 hex = 64 chars
    });
  });

  describe("isHmacConfigured", () => {
    it("returns true when HMAC_KEY is a 64-char hex string", () => {
      expect(isHmacConfigured()).toBe(true);
    });

    it("returns false when HMAC_KEY is not set", () => {
      const saved = process.env.HMAC_KEY;
      delete process.env.HMAC_KEY;
      expect(isHmacConfigured()).toBe(false);
      process.env.HMAC_KEY = saved;
    });
  });

  // --- Section 6: Key Rotation ---

  describe("reEncryptField", () => {
    it("roundtrip: decrypt old -> re-encrypt -> decrypt new = same plaintext", () => {
      const plaintext = "rotation-test@example.com";
      const original = encrypt(plaintext);

      const rotated = reEncryptField(original);

      // Must produce a new ciphertext (different IV)
      expect(rotated.iv).not.toBe(original.iv);
      expect(rotated.data).not.toBe(original.data);

      // Decrypting the rotated field must yield original plaintext
      expect(decrypt(rotated)).toBe(plaintext);
    });
  });

  // --- Section 7: Decryption Audit Logging ---

  describe("logDecryption", () => {
    it("calls logger.info with structured audit data", async () => {
      const loggerModule = await import("firebase-functions/logger");

      logDecryption("email", "record-42", "actor-7");

      expect(loggerModule.info).toHaveBeenCalledWith(
        "PII field decrypted",
        {
          event: "pii_decrypted",
          fieldKey: "email",
          recordId: "record-42",
          actorId: "actor-7",
        }
      );
    });
  });
});
