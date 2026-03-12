/**
 * Notion Database ID Registry
 *
 * Maps logical database names to Notion database IDs.
 * IDs are read from environment variables set via Firebase Functions config
 * or the defineSecret() mechanism.
 *
 * Environment variable naming convention:
 *   NOTION_DB_{UPPER_SNAKE_KEY} = "<notion-database-id>"
 *
 * Example:
 *   NOTION_DB_ONTOLOGY_CONCEPTS = "abc123..."
 *   NOTION_DB_GUEST = "def456..."
 */

import * as logger from "firebase-functions/logger";
import type { NotionDatabaseId } from "../ontology/types";

// --- Well-known ontology database keys ---

export const ONTOLOGY_DB_KEYS = {
  concepts: "ONTOLOGY_CONCEPTS",
  properties: "ONTOLOGY_PROPERTIES",
  relationships: "ONTOLOGY_RELATIONSHIPS",
  events: "ONTOLOGY_EVENTS",
  constraints: "ONTOLOGY_CONSTRAINTS",
  forms: "ONTOLOGY_FORMS",
  views: "ONTOLOGY_VIEWS",
  pages: "ONTOLOGY_PAGES",
  workflows: "ONTOLOGY_WORKFLOWS",
  roles: "ONTOLOGY_ROLES",
  permissions: "ONTOLOGY_PERMISSIONS",
  data_scopes: "ONTOLOGY_DATA_SCOPES",
  screen_access: "ONTOLOGY_SCREEN_ACCESS",
  events_log: "EVENTS_LOG",
  users: "USERS",
} as const;

// --- Resolved database IDs (cached after first read) ---

let resolvedIds: ReadonlyMap<string, NotionDatabaseId> | null = null;

/**
 * Reads all NOTION_DB_* environment variables and builds the registry.
 * Called lazily on first access.
 */
function buildRegistry(): ReadonlyMap<string, NotionDatabaseId> {
  const entries: Array<[string, NotionDatabaseId]> = [];

  for (const [_key, value] of Object.entries(process.env)) {
    // Skip non-Notion entries
    if (!_key.startsWith("NOTION_DB_") || !value) {
      continue;
    }
    // NOTION_DB_ONTOLOGY_CONCEPTS → ontology_concepts
    const logicalKey = _key.replace("NOTION_DB_", "").toLowerCase();
    entries.push([logicalKey, value]);
  }

  const registry = new Map(entries);
  logger.info(`Notion database registry loaded: ${registry.size} databases`, {
    keys: Array.from(registry.keys()),
  });
  return registry;
}

/**
 * Returns the Notion database ID for a given logical key.
 *
 * @param key - Logical database name. For ontology databases use the keys
 *              from ONTOLOGY_DB_KEYS (e.g. "ontology_concepts"). For domain
 *              concept databases, use the concept key (e.g. "guest").
 * @throws Error if the database ID is not configured.
 */
export function getDatabaseId(key: string): NotionDatabaseId {
  if (!resolvedIds) {
    resolvedIds = buildRegistry();
  }

  const normalizedKey = key.toLowerCase();
  const id = resolvedIds.get(normalizedKey);

  if (!id) {
    throw new Error(
      `No Notion database ID configured for "${key}". ` +
      `Set NOTION_DB_${key.toUpperCase()} environment variable.`
    );
  }

  return id;
}

/**
 * Returns the database ID for a well-known ontology database.
 */
export function getOntologyDatabaseId(
  ontologyKey: keyof typeof ONTOLOGY_DB_KEYS
): NotionDatabaseId {
  const envKey = ONTOLOGY_DB_KEYS[ontologyKey];
  return getDatabaseId(envKey);
}

/**
 * Checks whether a database ID is configured for the given key.
 */
export function hasDatabaseId(key: string): boolean {
  if (!resolvedIds) {
    resolvedIds = buildRegistry();
  }
  return resolvedIds.has(key.toLowerCase());
}

/**
 * Forces the registry to rebuild from environment variables.
 * Useful after config changes in tests or during hot reload.
 */
export function reloadDatabaseRegistry(): void {
  resolvedIds = null;
  logger.info("Notion database registry invalidated — will reload on next access");
}
