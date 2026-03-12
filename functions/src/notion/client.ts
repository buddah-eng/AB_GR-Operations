/**
 * Notion API Client Wrapper
 *
 * Wraps @notionhq/client with:
 *  - Rate limiting via a counting semaphore (max 2 concurrent requests)
 *  - Automatic retry on 429 (rate limit) responses with exponential backoff
 *  - Bidirectional conversion between Notion property format and flat JS objects
 */

import { Client } from "@notionhq/client";
import type {
  QueryDatabaseParameters,
  QueryDatabaseResponse,
  CreatePageParameters,
  UpdatePageParameters,
  GetPageResponse,
} from "@notionhq/client/build/src/api-endpoints";
import * as logger from "firebase-functions/logger";
import type { NotionDatabaseId, NotionPageId } from "../ontology/types";

// --- Rate-limit semaphore ---

class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.current--;
    }
  }
}

// --- Retry helpers ---

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Singleton Notion client ---

let notionClient: Client | null = null;
const semaphore = new Semaphore(2);

function getClient(): Client {
  if (!notionClient) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) {
      throw new Error("NOTION_API_KEY environment variable is not set");
    }
    notionClient = new Client({ auth: apiKey });
  }
  return notionClient;
}

/**
 * Executes a Notion API call with rate limiting and retry logic.
 */
async function withRateLimitAndRetry<T>(
  label: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  await semaphore.acquire();
  try {
    return await executeWithRetry(label, fn);
  } finally {
    semaphore.release();
  }
}

async function executeWithRetry<T>(
  label: string,
  fn: (client: Client) => Promise<T>,
  attempt = 0
): Promise<T> {
  try {
    return await fn(getClient());
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = (error as { headers?: Record<string, string> }).headers?.["retry-after"];
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn(`Rate limited on ${label}, retrying in ${delayMs}ms (attempt ${attempt + 1})`);
      await sleep(delayMs);
      return executeWithRetry(label, fn, attempt + 1);
    }
    throw error;
  }
}

// --- CRUD Operations ---

/**
 * Queries a Notion database with automatic pagination.
 * Returns all matching pages by following the `next_cursor`.
 */
export async function queryDatabase(
  databaseId: NotionDatabaseId,
  options?: {
    readonly filter?: QueryDatabaseParameters["filter"];
    readonly sorts?: QueryDatabaseParameters["sorts"];
    readonly pageSize?: number;
    readonly maxPages?: number;
  }
): Promise<ReadonlyArray<QueryDatabaseResponse["results"][number]>> {
  const allResults: QueryDatabaseResponse["results"][number][] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  const maxPages = options?.maxPages ?? 50; // safety limit

  do {
    const response = await withRateLimitAndRetry(
      `queryDatabase(${databaseId})`,
      (client) =>
        client.databases.query({
          database_id: databaseId,
          filter: options?.filter as QueryDatabaseParameters["filter"],
          sorts: options?.sorts as QueryDatabaseParameters["sorts"],
          page_size: options?.pageSize ?? 100,
          start_cursor: cursor,
        })
    );

    allResults.push(...response.results);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    pageCount++;
  } while (cursor && pageCount < maxPages);

  return allResults;
}

/**
 * Queries a single page of results from a Notion database.
 */
export async function queryDatabasePage(
  databaseId: NotionDatabaseId,
  options?: {
    readonly filter?: QueryDatabaseParameters["filter"];
    readonly sorts?: QueryDatabaseParameters["sorts"];
    readonly pageSize?: number;
    readonly startCursor?: string;
  }
): Promise<{
  readonly results: ReadonlyArray<QueryDatabaseResponse["results"][number]>;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly total: number;
}> {
  const response = await withRateLimitAndRetry(
    `queryDatabasePage(${databaseId})`,
    (client) =>
      client.databases.query({
        database_id: databaseId,
        filter: options?.filter as QueryDatabaseParameters["filter"],
        sorts: options?.sorts as QueryDatabaseParameters["sorts"],
        page_size: options?.pageSize ?? 100,
        start_cursor: options?.startCursor,
      })
  );

  return {
    results: response.results,
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
    total: response.results.length, // Notion doesn't provide total count
  };
}

/**
 * Retrieves a single Notion page by ID.
 */
export async function getPage(pageId: NotionPageId): Promise<GetPageResponse> {
  return withRateLimitAndRetry(
    `getPage(${pageId})`,
    (client) => client.pages.retrieve({ page_id: pageId })
  );
}

/**
 * Creates a new page in a Notion database.
 * Accepts a loosely-typed properties object for flexibility with
 * dynamically-constructed payloads. The Notion SDK validates at runtime.
 */
export async function createPage(
  databaseId: NotionDatabaseId,
  properties: Record<string, unknown>
): Promise<GetPageResponse> {
  return withRateLimitAndRetry(
    `createPage(${databaseId})`,
    (client) =>
      client.pages.create({
        parent: { database_id: databaseId },
        properties: properties as CreatePageParameters["properties"],
      }) as Promise<GetPageResponse>
  );
}

/**
 * Updates an existing Notion page's properties.
 * Accepts a loosely-typed properties object for flexibility with
 * dynamically-constructed payloads. The Notion SDK validates at runtime.
 */
export async function updatePage(
  pageId: NotionPageId,
  properties: Record<string, unknown>
): Promise<GetPageResponse> {
  return withRateLimitAndRetry(
    `updatePage(${pageId})`,
    (client) =>
      client.pages.update({
        page_id: pageId,
        properties: properties as UpdatePageParameters["properties"],
      }) as Promise<GetPageResponse>
  );
}

/**
 * Archives (soft-deletes) a Notion page.
 */
export async function archivePage(pageId: NotionPageId): Promise<GetPageResponse> {
  return withRateLimitAndRetry(
    `archivePage(${pageId})`,
    (client) =>
      client.pages.update({
        page_id: pageId,
        archived: true,
      }) as Promise<GetPageResponse>
  );
}

// --- Property Conversion: Notion → Flat JS Object ---

type NotionPropertyValue = Record<string, unknown> & { type: string };

/**
 * Extracts a plain JS value from a single Notion property object.
 */
export function extractPropertyValue(prop: NotionPropertyValue): unknown {
  switch (prop.type) {
    case "title": {
      const titleArr = prop.title as ReadonlyArray<{ plain_text: string }>;
      return titleArr.map((t) => t.plain_text).join("");
    }
    case "rich_text": {
      const textArr = prop.rich_text as ReadonlyArray<{ plain_text: string }>;
      return textArr.map((t) => t.plain_text).join("");
    }
    case "number":
      return prop.number as number | null;
    case "select": {
      const sel = prop.select as { name: string } | null;
      return sel?.name ?? null;
    }
    case "multi_select": {
      const options = prop.multi_select as ReadonlyArray<{ name: string }>;
      return options.map((o) => o.name);
    }
    case "date": {
      const d = prop.date as { start: string; end?: string } | null;
      if (!d) return null;
      return { start: d.start, end: d.end ?? undefined };
    }
    case "checkbox":
      return prop.checkbox as boolean;
    case "url":
      return prop.url as string | null;
    case "email":
      return prop.email as string | null;
    case "phone_number":
      return prop.phone_number as string | null;
    case "relation": {
      const rels = prop.relation as ReadonlyArray<{ id: string }>;
      return rels.map((r) => r.id);
    }
    case "status": {
      const status = prop.status as { name: string } | null;
      return status?.name ?? null;
    }
    case "formula": {
      const formula = prop.formula as Record<string, unknown>;
      // Formula type can be string, number, boolean, or date
      const formulaType = formula.type as string;
      return formula[formulaType] ?? null;
    }
    case "rollup": {
      const rollup = prop.rollup as Record<string, unknown>;
      const rollupType = rollup.type as string;
      return rollup[rollupType] ?? null;
    }
    case "files": {
      const files = prop.files as ReadonlyArray<{
        type: string;
        name: string;
        file?: { url: string };
        external?: { url: string };
      }>;
      return files.map((f) =>
        f.type === "file" ? f.file?.url : f.external?.url
      );
    }
    case "people": {
      const people = prop.people as ReadonlyArray<{ id: string; name?: string }>;
      return people.map((p) => p.id);
    }
    case "created_time":
      return prop.created_time as string;
    case "last_edited_time":
      return prop.last_edited_time as string;
    default:
      return null;
  }
}

/**
 * Converts all properties of a Notion page to a flat JS object.
 * Keys are the Notion property names.
 */
export function pageToFlatObject(
  page: Record<string, unknown>
): Readonly<Record<string, unknown>> {
  const props = (page as { properties: Record<string, NotionPropertyValue> }).properties;
  if (!props) return {};

  const entries = Object.entries(props).map(
    ([key, value]) => [key, extractPropertyValue(value)] as const
  );
  return Object.fromEntries(entries);
}

/**
 * Extracts page metadata (id, created_time, last_edited_time).
 */
export function pageMetadata(page: Record<string, unknown>): {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
} {
  return {
    id: page.id as string,
    createdAt: page.created_time as string,
    updatedAt: page.last_edited_time as string,
  };
}

// --- Property Conversion: Flat JS Value → Notion Property Format ---

/**
 * Builds a Notion property value object from a JS value and a Notion property type.
 */
export function buildPropertyValue(
  notionType: string,
  value: unknown
): Record<string, unknown> {
  switch (notionType) {
    case "title":
      return {
        title: [{ text: { content: String(value ?? "") } }],
      };
    case "rich_text":
      return {
        rich_text: [{ text: { content: String(value ?? "") } }],
      };
    case "number":
      return { number: value as number | null };
    case "select":
      return value ? { select: { name: String(value) } } : { select: null };
    case "multi_select": {
      const items = Array.isArray(value) ? value : [];
      return {
        multi_select: items.map((v) => ({ name: String(v) })),
      };
    }
    case "date": {
      if (!value) return { date: null };
      if (typeof value === "string") {
        return { date: { start: value } };
      }
      const dateVal = value as { start: string; end?: string };
      return { date: { start: dateVal.start, end: dateVal.end ?? null } };
    }
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "url":
      return { url: value ? String(value) : null };
    case "email":
      return { email: value ? String(value) : null };
    case "phone_number":
      return { phone_number: value ? String(value) : null };
    case "relation": {
      const ids = Array.isArray(value) ? value : [];
      return {
        relation: ids.map((id) => ({ id: String(id) })),
      };
    }
    case "status":
      return value ? { status: { name: String(value) } } : { status: null };
    default:
      logger.warn(`Unsupported Notion property type for write: ${notionType}`);
      return {};
  }
}

/**
 * Builds a complete Notion properties object from a flat key-value map.
 * `propertyTypes` maps each Notion property name to its Notion type string.
 */
export function buildNotionProperties(
  values: Readonly<Record<string, unknown>>,
  propertyTypes: Readonly<Record<string, string>>
): Record<string, Record<string, unknown>> {
  const entries = Object.entries(values)
    .filter(([key]) => key in propertyTypes)
    .map(([key, value]) => [key, buildPropertyValue(propertyTypes[key], value)] as const);

  return Object.fromEntries(entries);
}
