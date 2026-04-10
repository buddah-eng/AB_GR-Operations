import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkBulkLimit,
  sendBulkConfirmationRequired,
  clearExpiredConfirmations,
  _pendingConfirmations,
} from "./bulk-limit";

vi.mock("../db/client", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

describe("Bulk Operation Limit", () => {
  beforeEach(() => {
    _pendingConfirmations.clear();
  });

  describe("checkBulkLimit", () => {
    it("returns null when record count is below threshold (no confirmation needed)", () => {
      const result = checkBulkLimit("guest", "update", 4, "user-1");
      expect(result).toBeNull();
    });

    it("returns null when record count is below custom threshold", () => {
      const result = checkBulkLimit("guest", "update", 9, "user-1", undefined, 10);
      expect(result).toBeNull();
    });

    it("returns confirmation when record count meets threshold", () => {
      const result = checkBulkLimit("guest", "update", 5, "user-1");
      expect(result).not.toBeNull();
      expect(result!.token).toBeDefined();
      expect(result!.conceptKey).toBe("guest");
      expect(result!.operation).toBe("update");
      expect(result!.recordCount).toBe(5);
      expect(result!.actorId).toBe("user-1");
      expect(result!.expiresAt).toBeInstanceOf(Date);
    });

    it("returns confirmation when record count exceeds threshold", () => {
      const result = checkBulkLimit("guest", "delete", 10, "user-1");
      expect(result).not.toBeNull();
      expect(result!.recordCount).toBe(10);
    });

    it("stores confirmation token in pending map", () => {
      const result = checkBulkLimit("guest", "update", 5, "user-1");
      expect(_pendingConfirmations.has(result!.token)).toBe(true);
    });

    it("accepts valid confirmation token and returns null (proceed)", () => {
      const confirmation = checkBulkLimit("guest", "update", 5, "user-1");
      expect(confirmation).not.toBeNull();

      // Re-submit with the token
      const result = checkBulkLimit("guest", "update", 5, "user-1", confirmation!.token);
      expect(result).toBeNull();
    });

    it("consumes the token (cannot reuse)", () => {
      const confirmation = checkBulkLimit("guest", "update", 5, "user-1");
      checkBulkLimit("guest", "update", 5, "user-1", confirmation!.token);

      // Second use should fail
      expect(() =>
        checkBulkLimit("guest", "update", 5, "user-1", confirmation!.token)
      ).toThrow("Invalid or expired");
    });

    it("rejects invalid confirmation token", () => {
      expect(() =>
        checkBulkLimit("guest", "update", 5, "user-1", "invalid-token")
      ).toThrow("Invalid or expired");
    });

    it("rejects expired confirmation token", () => {
      const confirmation = checkBulkLimit("guest", "update", 5, "user-1");
      // Manually expire it
      const pending = _pendingConfirmations.get(confirmation!.token)!;
      _pendingConfirmations.set(confirmation!.token, {
        ...pending,
        expiresAt: new Date(Date.now() - 1000),
      });

      expect(() =>
        checkBulkLimit("guest", "update", 5, "user-1", confirmation!.token)
      ).toThrow("expired");
    });

    it("rejects token for wrong concept/operation", () => {
      const confirmation = checkBulkLimit("guest", "update", 5, "user-1");

      expect(() =>
        checkBulkLimit("staff", "update", 5, "user-1", confirmation!.token)
      ).toThrow("does not match");
    });
  });

  describe("sendBulkConfirmationRequired", () => {
    it("sends 202 response with token and record count", () => {
      const confirmation = checkBulkLimit("guest", "update", 7, "user-1")!;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };

      sendBulkConfirmationRequired(res as any, confirmation);

      expect(res.status).toHaveBeenCalledWith(202);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe("bulk_limit_exceeded");
      expect(body.data.confirmationToken).toBe(confirmation.token);
      expect(body.data.recordCount).toBe(7);
    });
  });

  describe("clearExpiredConfirmations", () => {
    it("removes expired confirmations", () => {
      checkBulkLimit("guest", "update", 5, "user-1");
      checkBulkLimit("staff", "delete", 5, "user-2");

      // Expire all
      for (const [token, conf] of _pendingConfirmations) {
        _pendingConfirmations.set(token, {
          ...conf,
          expiresAt: new Date(Date.now() - 1000),
        });
      }

      clearExpiredConfirmations();
      expect(_pendingConfirmations.size).toBe(0);
    });

    it("keeps non-expired confirmations", () => {
      checkBulkLimit("guest", "update", 5, "user-1");
      expect(_pendingConfirmations.size).toBe(1);

      clearExpiredConfirmations();
      expect(_pendingConfirmations.size).toBe(1);
    });
  });
});
