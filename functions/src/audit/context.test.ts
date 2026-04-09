import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuditContext, auditContextFromRequest, logAuditClaim, setAuditSessionVars } from "./context";

const mockQuery = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock("../db/client", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

describe("Audit Context", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  describe("createAuditContext", () => {
    it("generates a UUID change_set", () => {
      const ctx = createAuditContext("user-123", "human");
      expect(ctx.changeSet).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("preserves actor fields", () => {
      const ctx = createAuditContext("user-abc", "api_client", "192.168.1.1", "session-xyz");
      expect(ctx.actorId).toBe("user-abc");
      expect(ctx.actorType).toBe("api_client");
      expect(ctx.ipAddress).toBe("192.168.1.1");
      expect(ctx.sessionId).toBe("session-xyz");
    });

    it("generates unique change_set per call", () => {
      const ctx1 = createAuditContext("user-1", "human");
      const ctx2 = createAuditContext("user-1", "human");
      expect(ctx1.changeSet).not.toBe(ctx2.changeSet);
    });
  });

  describe("auditContextFromRequest", () => {
    it("extracts user and actor type from request", () => {
      const req = {
        user: { uid: "uid-123", email: "test@example.com" },
        actorType: "ai_agent" as const,
        ip: "10.0.0.1",
      };
      const ctx = auditContextFromRequest(req as any);
      expect(ctx.actorId).toBe("uid-123");
      expect(ctx.actorType).toBe("ai_agent");
      expect(ctx.ipAddress).toBe("10.0.0.1");
    });

    it("defaults to anonymous/human when request has no user", () => {
      const req = { ip: "127.0.0.1" };
      const ctx = auditContextFromRequest(req as any);
      expect(ctx.actorId).toBe("anonymous");
      expect(ctx.actorType).toBe("human");
    });
  });

  describe("setAuditSessionVars", () => {
    it("sets all session variables via SET LOCAL", async () => {
      const mockClient = { query: vi.fn().mockResolvedValue({}) };
      const ctx = createAuditContext("user-1", "human", "1.2.3.4", "sess-1");

      await setAuditSessionVars(mockClient as any, ctx);

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContainEqual(expect.stringContaining("SET LOCAL app.actor_id"));
      expect(calls).toContainEqual(expect.stringContaining("SET LOCAL app.actor_type"));
      expect(calls).toContainEqual(expect.stringContaining("SET LOCAL app.change_set"));
      expect(calls).toContainEqual(expect.stringContaining("SET LOCAL app.session_id"));
      expect(calls).toContainEqual(expect.stringContaining("SET LOCAL app.ip_address"));
    });

    it("skips optional fields when not provided", async () => {
      const mockClient = { query: vi.fn().mockResolvedValue({}) };
      const ctx = createAuditContext("user-1", "system");

      await setAuditSessionVars(mockClient as any, ctx);

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).not.toContainEqual(expect.stringContaining("session_id"));
      expect(calls).not.toContainEqual(expect.stringContaining("ip_address"));
    });

    it("escapes single quotes in actor_id", async () => {
      const mockClient = { query: vi.fn().mockResolvedValue({}) };
      const ctx = createAuditContext("user'with'quotes", "human");

      await setAuditSessionVars(mockClient as any, ctx);

      const actorCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("actor_id")
      );
      expect(actorCall).toBeDefined();
      expect(actorCall![0]).toContain("user''with''quotes");
    });
  });

  describe("logAuditClaim", () => {
    it("inserts into api_audit_claims", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
      const ctx = createAuditContext("user-1", "human");

      await logAuditClaim(ctx, "POST /api/domains/guest");

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO api_audit_claims"),
        [ctx.changeSet, "user-1", "human", "POST /api/domains/guest"]
      );
    });

    it("does not throw when insert fails", async () => {
      mockQuery.mockRejectedValue(new Error("connection refused"));
      const ctx = createAuditContext("user-1", "human");

      // Should not throw
      await expect(logAuditClaim(ctx, "POST /test")).resolves.toBeUndefined();
    });
  });
});
