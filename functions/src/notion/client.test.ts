import { describe, it, expect, vi } from "vitest";
import {
  extractPropertyValue,
  pageToFlatObject,
  pageMetadata,
  buildPropertyValue,
  buildNotionProperties,
} from "./client";

// Mock external deps that client.ts imports at module level
vi.mock("firebase-functions/logger", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- extractPropertyValue: Notion → JS ---

describe("extractPropertyValue", () => {
  it("extracts title text", () => {
    const prop = {
      type: "title",
      title: [{ plain_text: "Hello" }, { plain_text: " World" }],
    };
    expect(extractPropertyValue(prop)).toBe("Hello World");
  });

  it("extracts rich_text", () => {
    const prop = {
      type: "rich_text",
      rich_text: [{ plain_text: "Some text" }],
    };
    expect(extractPropertyValue(prop)).toBe("Some text");
  });

  it("returns empty string for empty rich_text", () => {
    const prop = { type: "rich_text", rich_text: [] };
    expect(extractPropertyValue(prop)).toBe("");
  });

  it("extracts number", () => {
    expect(extractPropertyValue({ type: "number", number: 42 })).toBe(42);
    expect(extractPropertyValue({ type: "number", number: null })).toBeNull();
    expect(extractPropertyValue({ type: "number", number: 0 })).toBe(0);
  });

  it("extracts select", () => {
    expect(
      extractPropertyValue({ type: "select", select: { name: "Confirmed" } })
    ).toBe("Confirmed");
    expect(
      extractPropertyValue({ type: "select", select: null })
    ).toBeNull();
  });

  it("extracts multi_select", () => {
    const prop = {
      type: "multi_select",
      multi_select: [{ name: "Anime" }, { name: "Gaming" }],
    };
    expect(extractPropertyValue(prop)).toEqual(["Anime", "Gaming"]);
  });

  it("extracts date", () => {
    expect(
      extractPropertyValue({
        type: "date",
        date: { start: "2026-03-15", end: "2026-03-17" },
      })
    ).toEqual({ start: "2026-03-15", end: "2026-03-17" });

    expect(
      extractPropertyValue({ type: "date", date: { start: "2026-03-15" } })
    ).toEqual({ start: "2026-03-15", end: undefined });

    expect(
      extractPropertyValue({ type: "date", date: null })
    ).toBeNull();
  });

  it("extracts checkbox", () => {
    expect(extractPropertyValue({ type: "checkbox", checkbox: true })).toBe(true);
    expect(extractPropertyValue({ type: "checkbox", checkbox: false })).toBe(false);
  });

  it("extracts url", () => {
    expect(
      extractPropertyValue({ type: "url", url: "https://example.com" })
    ).toBe("https://example.com");
    expect(extractPropertyValue({ type: "url", url: null })).toBeNull();
  });

  it("extracts email", () => {
    expect(
      extractPropertyValue({ type: "email", email: "test@ab.org" })
    ).toBe("test@ab.org");
  });

  it("extracts phone_number", () => {
    expect(
      extractPropertyValue({ type: "phone_number", phone_number: "+1-555-1234" })
    ).toBe("+1-555-1234");
  });

  it("extracts relation IDs", () => {
    const prop = {
      type: "relation",
      relation: [{ id: "page-1" }, { id: "page-2" }],
    };
    expect(extractPropertyValue(prop)).toEqual(["page-1", "page-2"]);
  });

  it("extracts empty relation", () => {
    expect(extractPropertyValue({ type: "relation", relation: [] })).toEqual([]);
  });

  it("extracts status", () => {
    expect(
      extractPropertyValue({ type: "status", status: { name: "In Progress" } })
    ).toBe("In Progress");
    expect(
      extractPropertyValue({ type: "status", status: null })
    ).toBeNull();
  });

  it("extracts formula (string type)", () => {
    expect(
      extractPropertyValue({
        type: "formula",
        formula: { type: "string", string: "Computed" },
      })
    ).toBe("Computed");
  });

  it("extracts formula (number type)", () => {
    expect(
      extractPropertyValue({
        type: "formula",
        formula: { type: "number", number: 99 },
      })
    ).toBe(99);
  });

  it("extracts rollup", () => {
    expect(
      extractPropertyValue({
        type: "rollup",
        rollup: { type: "number", number: 5 },
      })
    ).toBe(5);
  });

  it("extracts files", () => {
    const prop = {
      type: "files",
      files: [
        { type: "file", name: "photo.jpg", file: { url: "https://s3/photo.jpg" } },
        { type: "external", name: "doc.pdf", external: { url: "https://ext/doc.pdf" } },
      ],
    };
    expect(extractPropertyValue(prop)).toEqual([
      "https://s3/photo.jpg",
      "https://ext/doc.pdf",
    ]);
  });

  it("extracts people IDs", () => {
    const prop = {
      type: "people",
      people: [{ id: "user-1" }, { id: "user-2", name: "Alice" }],
    };
    expect(extractPropertyValue(prop)).toEqual(["user-1", "user-2"]);
  });

  it("extracts created_time", () => {
    expect(
      extractPropertyValue({ type: "created_time", created_time: "2026-03-10T10:00:00Z" })
    ).toBe("2026-03-10T10:00:00Z");
  });

  it("extracts last_edited_time", () => {
    expect(
      extractPropertyValue({ type: "last_edited_time", last_edited_time: "2026-03-12T15:30:00Z" })
    ).toBe("2026-03-12T15:30:00Z");
  });

  it("returns null for unknown types", () => {
    expect(extractPropertyValue({ type: "unknown_type" })).toBeNull();
  });
});

// --- pageToFlatObject ---

describe("pageToFlatObject", () => {
  it("converts a page with multiple property types to a flat object", () => {
    const page = {
      properties: {
        Name: { type: "title", title: [{ plain_text: "Tanaka Yuki" }] },
        Status: { type: "select", select: { name: "Confirmed" } },
        "Interpreter Required": { type: "checkbox", checkbox: true },
        Company: { type: "rich_text", rich_text: [{ plain_text: "Aniplex" }] },
      },
    };

    const flat = pageToFlatObject(page);
    expect(flat).toEqual({
      Name: "Tanaka Yuki",
      Status: "Confirmed",
      "Interpreter Required": true,
      Company: "Aniplex",
    });
  });

  it("returns empty object for page without properties", () => {
    expect(pageToFlatObject({})).toEqual({});
    expect(pageToFlatObject({ id: "page-1" })).toEqual({});
  });
});

// --- pageMetadata ---

describe("pageMetadata", () => {
  it("extracts id, createdAt, updatedAt", () => {
    const page = {
      id: "page-abc",
      created_time: "2026-03-10T10:00:00Z",
      last_edited_time: "2026-03-12T15:30:00Z",
    };

    expect(pageMetadata(page)).toEqual({
      id: "page-abc",
      createdAt: "2026-03-10T10:00:00Z",
      updatedAt: "2026-03-12T15:30:00Z",
    });
  });
});

// --- buildPropertyValue: JS → Notion ---

describe("buildPropertyValue", () => {
  it("builds title property", () => {
    expect(buildPropertyValue("title", "Hello")).toEqual({
      title: [{ text: { content: "Hello" } }],
    });
  });

  it("builds title with null value", () => {
    expect(buildPropertyValue("title", null)).toEqual({
      title: [{ text: { content: "" } }],
    });
  });

  it("builds rich_text property", () => {
    expect(buildPropertyValue("rich_text", "Some text")).toEqual({
      rich_text: [{ text: { content: "Some text" } }],
    });
  });

  it("builds number property", () => {
    expect(buildPropertyValue("number", 42)).toEqual({ number: 42 });
    expect(buildPropertyValue("number", null)).toEqual({ number: null });
    expect(buildPropertyValue("number", 0)).toEqual({ number: 0 });
  });

  it("builds select property", () => {
    expect(buildPropertyValue("select", "Active")).toEqual({
      select: { name: "Active" },
    });
    expect(buildPropertyValue("select", null)).toEqual({ select: null });
    expect(buildPropertyValue("select", "")).toEqual({ select: null });
  });

  it("builds multi_select property", () => {
    expect(buildPropertyValue("multi_select", ["A", "B"])).toEqual({
      multi_select: [{ name: "A" }, { name: "B" }],
    });
    expect(buildPropertyValue("multi_select", [])).toEqual({
      multi_select: [],
    });
    expect(buildPropertyValue("multi_select", "not-array")).toEqual({
      multi_select: [],
    });
  });

  it("builds date property", () => {
    expect(buildPropertyValue("date", "2026-03-15")).toEqual({
      date: { start: "2026-03-15" },
    });
    expect(
      buildPropertyValue("date", { start: "2026-03-15", end: "2026-03-17" })
    ).toEqual({
      date: { start: "2026-03-15", end: "2026-03-17" },
    });
    expect(buildPropertyValue("date", null)).toEqual({ date: null });
  });

  it("builds checkbox property", () => {
    expect(buildPropertyValue("checkbox", true)).toEqual({ checkbox: true });
    expect(buildPropertyValue("checkbox", false)).toEqual({ checkbox: false });
    expect(buildPropertyValue("checkbox", 0)).toEqual({ checkbox: false });
    expect(buildPropertyValue("checkbox", "truthy")).toEqual({ checkbox: true });
  });

  it("builds url property", () => {
    expect(buildPropertyValue("url", "https://ab.org")).toEqual({
      url: "https://ab.org",
    });
    expect(buildPropertyValue("url", null)).toEqual({ url: null });
  });

  it("builds email property", () => {
    expect(buildPropertyValue("email", "test@ab.org")).toEqual({
      email: "test@ab.org",
    });
  });

  it("builds phone_number property", () => {
    expect(buildPropertyValue("phone_number", "+1-555-0123")).toEqual({
      phone_number: "+1-555-0123",
    });
  });

  it("builds relation property", () => {
    expect(buildPropertyValue("relation", ["id-1", "id-2"])).toEqual({
      relation: [{ id: "id-1" }, { id: "id-2" }],
    });
    expect(buildPropertyValue("relation", [])).toEqual({ relation: [] });
    expect(buildPropertyValue("relation", "not-array")).toEqual({ relation: [] });
  });

  it("builds status property", () => {
    expect(buildPropertyValue("status", "Done")).toEqual({
      status: { name: "Done" },
    });
    expect(buildPropertyValue("status", null)).toEqual({ status: null });
  });

  it("returns empty object for unsupported types", () => {
    expect(buildPropertyValue("formula", "computed")).toEqual({});
    expect(buildPropertyValue("rollup", 5)).toEqual({});
  });
});

// --- buildNotionProperties ---

describe("buildNotionProperties", () => {
  it("builds properties only for keys present in propertyTypes", () => {
    const values = {
      Name: "Tanaka Yuki",
      Status: "Confirmed",
      UnknownField: "should be ignored",
    };

    const propertyTypes = {
      Name: "title",
      Status: "select",
    };

    const result = buildNotionProperties(values, propertyTypes);
    expect(result).toEqual({
      Name: { title: [{ text: { content: "Tanaka Yuki" } }] },
      Status: { select: { name: "Confirmed" } },
    });
    expect(result).not.toHaveProperty("UnknownField");
  });

  it("handles empty values", () => {
    const result = buildNotionProperties({}, { Name: "title" });
    expect(result).toEqual({});
  });

  // --- Chained roundtrip: Notion → JS → Notion ---

  it("roundtrips: extract → build preserves data", () => {
    // Simulate a Notion page
    const notionPage = {
      properties: {
        Name: { type: "title", title: [{ plain_text: "Guest A" }] },
        Department: { type: "select", select: { name: "Anime" } },
        "Interpreter Required": { type: "checkbox", checkbox: true },
        Notes: { type: "rich_text", rich_text: [{ plain_text: "VIP" }] },
        Score: { type: "number", number: 95 },
      },
    };

    // Step 1: Convert Notion page to flat object
    const flat = pageToFlatObject(notionPage);
    expect(flat).toEqual({
      Name: "Guest A",
      Department: "Anime",
      "Interpreter Required": true,
      Notes: "VIP",
      Score: 95,
    });

    // Step 2: Convert flat object back to Notion properties
    const propertyTypes = {
      Name: "title",
      Department: "select",
      "Interpreter Required": "checkbox",
      Notes: "rich_text",
      Score: "number",
    };

    const rebuilt = buildNotionProperties(flat, propertyTypes);

    expect(rebuilt.Name).toEqual({ title: [{ text: { content: "Guest A" } }] });
    expect(rebuilt.Department).toEqual({ select: { name: "Anime" } });
    expect(rebuilt["Interpreter Required"]).toEqual({ checkbox: true });
    expect(rebuilt.Notes).toEqual({
      rich_text: [{ text: { content: "VIP" } }],
    });
    expect(rebuilt.Score).toEqual({ number: 95 });
  });
});
