/**
 * Shared Notion helpers for GR-Ops database setup and seeding.
 *
 * Provides:
 *  - Notion client initialization from .env
 *  - Database creation under a parent page
 *  - Property-type mapping (our ontology types -> Notion property schemas)
 *  - Rate-limit-aware batch operations
 *  - Manifest reading / writing
 */

import { Client } from "@notionhq/client";
import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

config({ path: resolve(import.meta.dirname ?? ".", "../.env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in the values.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Notion client singleton
// ---------------------------------------------------------------------------

let _client: Client | undefined;

export function getNotionClient(): Client {
  if (!_client) {
    _client = new Client({ auth: requireEnv("NOTION_API_KEY") });
  }
  return _client;
}

export function getParentPageId(): string {
  return requireEnv("NOTION_PARENT_PAGE_ID");
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

const MANIFEST_PATH = resolve(
  import.meta.dirname ?? ".",
  "../manifest.json"
);

export interface Manifest {
  readonly createdAt: string;
  readonly parentPageId: string;
  readonly databases: Readonly<Record<string, string>>; // slug -> database id
}

export function readManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      `manifest.json not found at ${MANIFEST_PATH}.\n` +
        `Run "npx tsx src/create-databases.ts" first to create all databases.`
    );
  }
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Manifest;
}

export function writeManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

export function requireDatabaseId(manifest: Manifest, slug: string): string {
  const id = manifest.databases[slug];
  if (!id) {
    throw new Error(
      `Database "${slug}" not found in manifest.json. ` +
        `Re-run create-databases.ts to regenerate.`
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Rate-limit-aware helpers
// ---------------------------------------------------------------------------

const RATE_LIMIT_DELAY_MS = 350; // Notion allows ~3 req/s; 350ms is safe

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Execute an array of async operations in order, sleeping between each to
 * respect Notion's rate limit (3 requests / second for integrations).
 */
export async function batchExecute<T>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await fn(items[i], i);
    if (i < items.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Notion property type mapping
// ---------------------------------------------------------------------------

/**
 * Describes a single Notion property definition we want to add to a database.
 * `notionType` is the Notion API property type key.
 * `config` is the nested config object for that type (e.g. select options).
 */
export interface NotionPropertyDef {
  readonly name: string;
  readonly notionType: string;
  readonly config: Record<string, unknown>;
}

export interface SelectOptionDef {
  readonly name: string;
  readonly color?: string;
}

/**
 * Build a Notion property schema object for a given "our" property type.
 */
export function mapPropertyType(
  name: string,
  type: string,
  options?: {
    readonly selectOptions?: readonly SelectOptionDef[];
    readonly multiSelectOptions?: readonly SelectOptionDef[];
  }
): NotionPropertyDef {
  switch (type) {
    case "title":
      return { name, notionType: "title", config: {} };

    case "text":
      return { name, notionType: "rich_text", config: {} };

    case "rich_text":
      return { name, notionType: "rich_text", config: {} };

    case "number":
      return { name, notionType: "number", config: { format: "number" } };

    case "select":
      return {
        name,
        notionType: "select",
        config: {
          options: (options?.selectOptions ?? []).map((o) => ({
            name: o.name,
            ...(o.color ? { color: o.color } : {}),
          })),
        },
      };

    case "multi_select":
      return {
        name,
        notionType: "multi_select",
        config: {
          options: (options?.multiSelectOptions ?? []).map((o) => ({
            name: o.name,
            ...(o.color ? { color: o.color } : {}),
          })),
        },
      };

    case "date":
    case "datetime":
      return { name, notionType: "date", config: {} };

    case "checkbox":
      return { name, notionType: "checkbox", config: {} };

    case "url":
      return { name, notionType: "url", config: {} };

    case "email":
      return { name, notionType: "email", config: {} };

    case "phone":
    case "phone_number":
      return { name, notionType: "phone_number", config: {} };

    case "status":
      return { name, notionType: "status", config: {} };

    default:
      // Fall back to rich_text for unknown types
      return { name, notionType: "rich_text", config: {} };
  }
}

// ---------------------------------------------------------------------------
// Database creation helper
// ---------------------------------------------------------------------------

export interface DatabaseSpec {
  readonly slug: string; // machine-readable key for manifest
  readonly title: string; // human-readable Notion database title
  readonly icon?: string; // emoji
  readonly properties: readonly NotionPropertyDef[];
}

/**
 * Create a single Notion database under the parent page.
 * Returns the new database ID.
 */
export async function createDatabase(spec: DatabaseSpec): Promise<string> {
  const notion = getNotionClient();
  const parentPageId = getParentPageId();

  // Build the properties object for the Notion API.
  // The first property MUST be a "title" type.
  const properties: Record<string, Record<string, unknown>> = {};

  for (const prop of spec.properties) {
    properties[prop.name] = { [prop.notionType]: prop.config };
  }

  const response = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: spec.title } }],
    ...(spec.icon ? { icon: { type: "emoji", emoji: spec.icon as any } } : {}),
    properties: properties as any,
  });

  return response.id;
}

// ---------------------------------------------------------------------------
// Page creation helper (for seeding rows into databases)
// ---------------------------------------------------------------------------

/**
 * Convenience type for the values we can set on a page.
 */
export type PagePropertyValue =
  | { type: "title"; value: string }
  | { type: "rich_text"; value: string }
  | { type: "number"; value: number }
  | { type: "select"; value: string }
  | { type: "multi_select"; value: readonly string[] }
  | { type: "date"; value: string; end?: string }
  | { type: "checkbox"; value: boolean }
  | { type: "url"; value: string }
  | { type: "email"; value: string }
  | { type: "phone_number"; value: string };

/**
 * Build the Notion API property payload for a page create call.
 */
export function buildPageProperties(
  fields: Readonly<Record<string, PagePropertyValue>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, pv] of Object.entries(fields)) {
    switch (pv.type) {
      case "title":
        result[name] = {
          title: [{ text: { content: pv.value } }],
        };
        break;
      case "rich_text":
        result[name] = {
          rich_text: [{ text: { content: pv.value } }],
        };
        break;
      case "number":
        result[name] = { number: pv.value };
        break;
      case "select":
        result[name] = { select: { name: pv.value } };
        break;
      case "multi_select":
        result[name] = {
          multi_select: pv.value.map((v) => ({ name: v })),
        };
        break;
      case "date":
        result[name] = {
          date: { start: pv.value, ...(pv.end ? { end: pv.end } : {}) },
        };
        break;
      case "checkbox":
        result[name] = { checkbox: pv.value };
        break;
      case "url":
        result[name] = { url: pv.value };
        break;
      case "email":
        result[name] = { email: pv.value };
        break;
      case "phone_number":
        result[name] = { phone_number: pv.value };
        break;
    }
  }

  return result;
}

/**
 * Create a single page (row) in a Notion database.
 * Returns the new page ID.
 */
export async function createPage(
  databaseId: string,
  fields: Readonly<Record<string, PagePropertyValue>>
): Promise<string> {
  const notion = getNotionClient();
  const properties = buildPageProperties(fields);

  const response = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: properties as any,
  });

  return response.id;
}
