/**
 * Search Service (Typesense integration stub)
 *
 * Provides full-text search across domain concepts with RBAC filtering.
 * The actual search client (Typesense) is injected — tests use a mock,
 * production uses the real client.
 *
 * Subscribes to the event bus at priority 800 to keep the search index
 * in sync with domain record changes.
 */

import * as logger from "firebase-functions/logger";
import { subscribe } from "../events/bus";
import { query } from "../db/client";
import type { DomainEvent } from "../events/types";

// --- Types ---

export interface SearchDocument {
  readonly id: string;
  readonly concept: string;
  readonly data: Record<string, unknown>;
}

export interface SearchResult {
  readonly hits: ReadonlyArray<SearchHit>;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface SearchHit {
  readonly id: string;
  readonly concept: string;
  readonly data: Record<string, unknown>;
  readonly score: number;
}

export interface AutocompleteResult {
  readonly suggestions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly concept: string;
  }>;
}

export interface ServiceResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

// --- Search client interface (injectable) ---

export interface SearchClient {
  index(collection: string, document: SearchDocument): Promise<void>;
  update(collection: string, id: string, document: Partial<SearchDocument>): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  search(
    collections: ReadonlyArray<string>,
    query: string,
    options?: { page?: number; limit?: number; filters?: Record<string, unknown> }
  ): Promise<SearchResult>;
  autocomplete(
    collection: string,
    query: string,
    limit?: number
  ): Promise<AutocompleteResult>;
}

// --- Injected search client ---

let _searchClient: SearchClient | null = null;

export function setSearchClient(client: SearchClient): void {
  _searchClient = client;
}

export function resetSearchClient(): void {
  _searchClient = null;
}

function getSearchClient(): SearchClient {
  if (!_searchClient) {
    throw new Error("Search client not configured. Call setSearchClient() first.");
  }
  return _searchClient;
}

// --- RBAC checker (injectable for testing) ---

export type RBACChecker = (
  roleKey: string,
  conceptKey: string,
  action: string
) => Promise<boolean>;

let _rbacChecker: RBACChecker = defaultRBACChecker;

export function setRBACChecker(checker: RBACChecker): void {
  _rbacChecker = checker;
}

export function resetRBACChecker(): void {
  _rbacChecker = defaultRBACChecker;
}

async function defaultRBACChecker(
  roleKey: string,
  conceptKey: string,
  action: string
): Promise<boolean> {
  const { roleEngine } = await import("../roles/engine");
  return roleEngine.canPerformAction(roleKey, conceptKey, action);
}

// --- Registration ---

/**
 * Subscribes to the event bus at priority 800 for search indexing.
 * Returns an unsubscribe function.
 */
export function registerSearchIndexer(): () => void {
  return subscribe("*", handleDomainEvent, 800);
}

// --- Event handler ---

/**
 * Indexes, updates, or deletes a record in the search index
 * based on the domain event action.
 */
export async function handleDomainEvent(event: DomainEvent): Promise<void> {
  try {
    const client = getSearchClient();
    const collection = event.domain;

    switch (event.action) {
      case "created":
      case "external_created":
      case "intake_received": {
        const document: SearchDocument = {
          id: event.recordId,
          concept: event.domain,
          data: (event.newValues as Record<string, unknown>) ?? {},
        };
        await client.index(collection, document);
        break;
      }

      case "updated":
      case "external_updated":
      case "synced": {
        const updateDoc: Partial<SearchDocument> = {
          data: (event.newValues as Record<string, unknown>) ?? {},
        };
        await client.update(collection, event.recordId, updateDoc);
        break;
      }

      case "deleted": {
        await client.delete(collection, event.recordId);
        break;
      }

      default:
        logger.debug("Search indexer: skipping event action", {
          action: event.action,
        });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Search indexing failed", {
      eventName: event.eventName,
      error: message,
    });
  }
}

// --- Search ---

/**
 * Searches across concepts with RBAC filtering.
 * Only returns results for concepts the user's role can view.
 */
export async function search(
  queryText: string,
  roleKey: string,
  concepts?: ReadonlyArray<string>,
  filters?: Record<string, unknown>,
  page?: number,
  limit?: number
): Promise<ServiceResult<SearchResult>> {
  try {
    const client = getSearchClient();

    const targetConcepts = concepts ?? ["guest", "schedule", "task"];

    // RBAC filter: only search concepts the role can view
    const allowedConcepts: string[] = [];
    for (const concept of targetConcepts) {
      const canView = await _rbacChecker(roleKey, concept, "view");
      if (canView) {
        allowedConcepts.push(concept);
      }
    }

    if (allowedConcepts.length === 0) {
      return {
        success: true,
        data: { hits: [], total: 0, page: page ?? 1, limit: limit ?? 20 },
      };
    }

    const result = await client.search(allowedConcepts, queryText, {
      page,
      limit,
      filters,
    });

    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Search failed", { error: message });
    return { success: false, error: `Search failed: ${message}` };
  }
}

// --- Autocomplete ---

/**
 * Provides autocomplete suggestions for a specific concept.
 */
export async function autocomplete(
  queryText: string,
  concept: string,
  roleKey: string
): Promise<ServiceResult<AutocompleteResult>> {
  try {
    const canView = await _rbacChecker(roleKey, concept, "view");
    if (!canView) {
      return { success: true, data: { suggestions: [] } };
    }

    const client = getSearchClient();
    const result = await client.autocomplete(concept, queryText);

    return { success: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Autocomplete failed", { error: message });
    return { success: false, error: `Autocomplete failed: ${message}` };
  }
}

// --- Reindex ---

/**
 * Full re-index of a concept from Postgres.
 */
export async function reindex(
  conceptKey: string
): Promise<ServiceResult<{ indexed: number }>> {
  try {
    const client = getSearchClient();

    const result = await query(
      "SELECT id, data FROM domain_records WHERE concept_key = $1",
      [conceptKey]
    );

    let indexed = 0;
    for (const row of result.rows) {
      const document: SearchDocument = {
        id: row.id as string,
        concept: conceptKey,
        data: (row.data as Record<string, unknown>) ?? {},
      };
      await client.index(conceptKey, document);
      indexed++;
    }

    logger.info("Reindex complete", { conceptKey, indexed });

    return { success: true, data: { indexed } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Reindex failed", { error: message });
    return { success: false, error: `Reindex failed: ${message}` };
  }
}
