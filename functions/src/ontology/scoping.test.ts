import { describe, it, expect } from "vitest";

import {
  validateScopePermission,
  buildScopeFilter,
  formatPropertyKey,
  stripPropertyPrefix,
} from "./scoping";

// --- validateScopePermission ---

describe("validateScopePermission", () => {
  it("admin can mutate org-wide records", () => {
    const result = validateScopePermission("admin", 1, "org", null, null);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("non-admin cannot mutate org-wide records", () => {
    const result = validateScopePermission("coordinator", 30, "org", null, "gr");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cannot mutate org-wide records");
  });

  it("dept director can mutate own department records", () => {
    const result = validateScopePermission(
      "director",
      20,
      "department",
      "gr",
      "gr"
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("dept director cannot mutate other department records", () => {
    const result = validateScopePermission(
      "director",
      20,
      "department",
      "exhibits",
      "gr"
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('department "gr"');
    expect(result.reason).toContain('department "exhibits"');
  });

  it("admin can mutate any department records", () => {
    const result = validateScopePermission(
      "admin",
      1,
      "department",
      "exhibits",
      "gr"
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("director at priority boundary (10) can mutate org-wide records", () => {
    const result = validateScopePermission("director", 10, "org", null, "gr");

    expect(result.allowed).toBe(true);
  });

  it("role just above priority threshold (11) cannot mutate org-wide records", () => {
    const result = validateScopePermission("coordinator", 11, "org", null, "gr");

    expect(result.allowed).toBe(false);
  });
});

// --- buildScopeFilter ---

describe("buildScopeFilter", () => {
  it("admin gets no filter (sees everything)", () => {
    const filter = buildScopeFilter("admin", 1, "gr");

    expect(filter).toBeNull();
  });

  it("dept director sees org-wide + own department", () => {
    const filter = buildScopeFilter("director", 20, "gr");

    expect(filter).toContain("owner_scope = 'org'");
    expect(filter).toContain("owner_department = 'gr'");
  });

  it("viewer sees org-wide only", () => {
    const filter = buildScopeFilter("viewer", 50, null);

    expect(filter).toBe("(owner_scope = 'org')");
  });

  it("admin at priority boundary (10) gets no filter", () => {
    const filter = buildScopeFilter("director", 10, "gr");

    expect(filter).toBeNull();
  });
});

// --- formatPropertyKey ---

describe("formatPropertyKey", () => {
  it("formats correctly with department prefix", () => {
    const result = formatPropertyKey("skills", "anime");

    expect(result).toBe("anime__skills");
  });

  it("formats with different department and key", () => {
    const result = formatPropertyKey("liaison_notes", "gr");

    expect(result).toBe("gr__liaison_notes");
  });
});

// --- stripPropertyPrefix ---

describe("stripPropertyPrefix", () => {
  it("strips prefix correctly", () => {
    const result = stripPropertyPrefix("anime__skills");

    expect(result).toBe("skills");
  });

  it("returns key unchanged when no prefix", () => {
    const result = stripPropertyPrefix("skills");

    expect(result).toBe("skills");
  });

  it("handles keys with multiple separators (strips only the first prefix)", () => {
    const result = stripPropertyPrefix("dept__nested__key");

    expect(result).toBe("nested__key");
  });
});

// --- Property extension roundtrip ---

describe("Property extension pattern", () => {
  it("formatted key survives roundtrip (format then strip)", () => {
    const originalKey = "liaison_notes";
    const department = "gr";

    const formatted = formatPropertyKey(originalKey, department);
    const stripped = stripPropertyPrefix(formatted);

    expect(stripped).toBe(originalKey);
  });

  it("roundtrip works for various department/key combinations", () => {
    const cases = [
      { key: "skills", dept: "anime" },
      { key: "notes", dept: "exhibits" },
      { key: "panel_limit", dept: "programming" },
    ];

    for (const { key, dept } of cases) {
      const formatted = formatPropertyKey(key, dept);
      const stripped = stripPropertyPrefix(formatted);
      expect(stripped).toBe(key);
    }
  });
});
