# Platform Search

> Full-text search across all concepts, forms, configs. Uses an OSS search engine --
> don't reinvent indexing. Typesense or Meilisearch (not Elasticsearch). Event bus
> subscriber at priority 800 keeps the index in sync. RBAC filters every search result.
> Encrypted PII fields are NOT indexed -- search by blind index HMAC for email.
> Postgres is the system of record; the search engine is a derived index.

---

## Overview

The platform stores structured data across dozens of ontology concepts: guests, staff, events, venues, transport bookings, contracts, templates, and more. As the dataset grows (hundreds of guests, thousands of prep items, multiple years of convention data), users need to find records quickly across concept boundaries.

Postgres full-text search (`tsvector`/`tsquery`) works for single-table queries but lacks typo tolerance, relevance ranking across tables, faceted search, and real-time autocomplete performance. This PRD introduces a dedicated search engine as a sidecar service that indexes all searchable domain data and serves search queries with sub-50ms latency.

**Dependencies:**
- `core/event-bus.md` -- subscribes to domain events for real-time index sync
- `core/rbac-engine.md` -- filters search results by caller's permissions
- `core/ontology-engine.md` -- determines which properties are searchable
- `data/encryption.md` -- encrypted fields are searched via blind index, not decrypted text
- `api/domain-crud.md` -- search API follows same auth/RBAC patterns

**What this PRD covers:** Search engine selection, index strategy, sync pipeline, search API, RBAC filtering, autocomplete, deployment, and re-index recovery.

**What this PRD does NOT cover:** AI/vector/semantic search (not needed for convention operations). Full-text search within generated PDF documents. Analytics or reporting queries (those use Postgres directly).

---

## 1. Search Engine Selection

### Purpose

Evaluate OSS search engines and recommend one for the platform.

### Detail

**Candidates:**

| Criterion | Typesense | Meilisearch |
|-----------|-----------|-------------|
| License | GPL-3.0 (OSS) | MIT (OSS) |
| Typo tolerance | Yes (configurable) | Yes (built-in, excellent) |
| Relevance ranking | Custom ranking rules | Custom ranking rules |
| Faceted search | Yes | Yes |
| Memory footprint | ~50-100MB for small datasets | ~50-100MB for small datasets |
| API | RESTful JSON | RESTful JSON |
| Client SDKs | Node.js, Python, etc. | Node.js, Python, etc. |
| Multi-index search | Yes (multi_search endpoint) | Yes (multi-search endpoint) |
| Filtering | Yes (filter expressions) | Yes (filter expressions) |
| Sorting | Yes | Yes |
| Geo search | Yes | Yes |
| Docker support | Official image | Official image |
| Cloud Run sidecar | Yes (small footprint) | Yes (small footprint) |
| Document limit | Unlimited | Unlimited |
| Indexing speed | ~10,000 docs/sec | ~10,000 docs/sec |

**Recommendation: Typesense.**

Rationale:
1. **Stricter relevance control.** Typesense's ranking rules are more configurable, which matters when searching across concepts with different field importance.
2. **Lower memory usage.** Typesense is written in C++ and has a smaller memory footprint than Meilisearch (Rust) at the same dataset size.
3. **Multi-search with per-collection parameters.** Typesense's `multi_search` endpoint allows searching multiple collections with different parameters in a single request -- essential for cross-concept search.
4. **API key scoping.** Typesense supports scoped API keys that restrict search to specific collections, aligning with RBAC filtering.
5. **Production track record.** Typesense has been used in production at larger scale than Meilisearch.

Either engine would work. If the team has a strong preference for Meilisearch, the architecture is identical -- swap the client SDK and adjust API calls.

### Acceptance Criteria

- [ ] Search engine selection is documented with rationale.
- [ ] The chosen engine runs as a sidecar container with < 200MB memory.
- [ ] The engine supports typo-tolerant, multi-collection search with sub-50ms latency for datasets under 100,000 documents.

---

## 2. Index Strategy

### Purpose

Define how domain data maps to search engine collections (indexes).

### Detail

**One collection per concept.** Each ontology concept with searchable data gets its own Typesense collection. Collections are named `{concept_key}` (e.g., `guest`, `staff`, `schedule_event`, `template`).

**Schema generation from ontology:**

The indexing service reads the ontology to determine which properties to index for each concept. The following property types are searchable:

| Property type | Indexed as | Searchable | Filterable | Sortable |
|---------------|-----------|------------|------------|----------|
| `text` | `string` | Yes | No | No |
| `textarea` | `string` | Yes | No | No |
| `email` | N/A (encrypted) | Via blind index only | Via HMAC | No |
| `phone` | N/A (encrypted) | Via blind index only | Via HMAC | No |
| `select` | `string` | Yes | Yes | Yes |
| `multi_select` | `string[]` | Yes | Yes | No |
| `number` | `int64` / `float` | No | Yes | Yes |
| `date` | `int64` (epoch) | No | Yes | Yes |
| `datetime` | `int64` (epoch) | No | Yes | Yes |
| `boolean` | `bool` | No | Yes | No |
| `relation` | `string` (record ID) | No | Yes | No |
| `url` | `string` | Yes | No | No |

**Always indexed (system fields):**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `string` | Primary key |
| `name` / `title` | `string` | Primary display field (varies by concept) |
| `status` | `string` | Lifecycle state |
| `department` | `string` | Department ownership |
| `created_at` | `int64` | Sort by recency |
| `updated_at` | `int64` | Sort by last modified |

**Encrypted PII handling:**

Fields marked `encrypted: true` in the ontology (see `data/encryption.md`) are NEVER indexed with their plaintext value. For email fields specifically:

1. The blind index HMAC (`email_hmac` column) is stored in the search index as a filterable (not searchable) field.
2. To search for a user by email, the API computes `HMAC-SHA256(query, hmac_key)` and filters the search index by the HMAC value.
3. This enables exact-match email lookup without exposing plaintext email to the search engine.
4. Partial email search is not supported for encrypted fields (by design -- partial PII search is a privacy risk).

Other encrypted fields (phone, passport, dietary restrictions, etc.) are not indexed at all. They are findable only through the Postgres application layer by authorized roles.

**Collection schema example (guest concept):**

```json
{
  "name": "guest",
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "name", "type": "string" },
    { "name": "company", "type": "string", "optional": true },
    { "name": "type", "type": "string", "facet": true },
    { "name": "status", "type": "string", "facet": true },
    { "name": "department", "type": "string", "facet": true },
    { "name": "email_hmac", "type": "string", "index": false, "optional": true },
    { "name": "created_at", "type": "int64" },
    { "name": "updated_at", "type": "int64" }
  ],
  "default_sorting_field": "updated_at"
}
```

### Acceptance Criteria

- [ ] One Typesense collection exists per searchable concept.
- [ ] Collection schemas are derived from the ontology property definitions.
- [ ] Encrypted PII fields are NOT stored as searchable text in the search index.
- [ ] Email lookup uses blind index HMAC filtering, not plaintext search.
- [ ] Text, textarea, select, and url property types are searchable.
- [ ] Number, date, boolean, and relation types are filterable but not text-searchable.

---

## 3. Real-Time Index Sync

### Purpose

Keep the search index in sync with Postgres via event bus subscription.

### Detail

The search sync service registers an event bus subscriber on startup:

```typescript
subscribe('*', handleSearchIndexSync, 800)
```

**Priority 800** places it after domain handlers (100) and before notification delivery (900). Search indexing is important for user experience but should not delay notifications or real-time updates.

**Sync handler logic:**

| Domain event action | Search index operation |
|--------------------|-----------------------|
| `created` | Index (upsert) the new record |
| `updated` | Update the indexed document with changed fields |
| `deleted` | Remove the document from the index |
| `external_created` | Index the new record |
| `external_updated` | Update the indexed document |

**Sync process for a single event:**

1. Extract `domain` (concept key), `recordId`, and `action` from the event.
2. Check if the concept has a search collection (some concepts may not be searchable).
3. For `created`/`updated`: Fetch the current record from Postgres (to get all indexed fields). Build the search document from the record's properties using the ontology-defined schema. Upsert into the Typesense collection.
4. For `deleted`: Delete the document by `id` from the Typesense collection.
5. Update the `search_sync_state` table with the last-synced event ID for the concept.

**Why fetch from Postgres?** The domain event payload may contain only `changedFields` and `newValues`, not the full record. For search indexing, we need all searchable fields (the name, status, department, etc. -- not just the changed fields). Fetching the full record from Postgres ensures the search document is complete.

**Error handling:**

- If the search engine is unavailable, log the error and emit a `search.sync_failed` event. The event bus handler does not throw -- search sync failure must not block other handlers.
- Failed syncs are tracked in `search_sync_state` for later retry.
- A background job runs every 60 seconds to retry failed syncs.

**`search_sync_state` table:**

```sql
CREATE TABLE search_sync_state (
  concept_key       TEXT PRIMARY KEY,
  last_synced_event_id UUID,
  last_synced_at    TIMESTAMPTZ,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Acceptance Criteria

- [ ] Search sync subscriber registered at priority 800 with pattern `*`.
- [ ] Record creation in Postgres results in the record being searchable within 5 seconds.
- [ ] Record update in Postgres results in updated search results within 5 seconds.
- [ ] Record deletion removes the document from the search index.
- [ ] Search engine unavailability does not block domain event processing.
- [ ] `search_sync_state` tracks the last-synced event per concept.
- [ ] Failed syncs are retried automatically.

---

## 4. Search API

### Purpose

Define the HTTP endpoint for searching across concepts.

### Detail

**Endpoint:** `GET /api/search`

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | `string` | Yes | Search query text. Min 1 character. |
| `concepts` | `string` | No | Comma-separated concept keys to search within. Default: all searchable concepts the user can view. |
| `limit` | `number` | No | Max results per concept. Default 10, max 50. |
| `page` | `number` | No | Page number for pagination. Default 1. |
| `filters` | `string` | No | JSON-encoded filter expressions (see Faceted Search, Section 6). |
| `sort` | `string` | No | Sort field and direction. e.g., `updated_at:desc`. Default: relevance. |

**Request flow:**

1. Authenticate via standard `authMiddleware()`.
2. If `concepts` is specified, filter to only concepts the caller's role can view (`canPerformAction(roleKey, conceptKey, 'view')`). If no concepts specified, auto-discover all viewable concepts.
3. Build a Typesense `multi_search` request with one search per concept.
4. Execute the search.
5. For each result, apply RBAC field filtering (strip fields the caller cannot see).
6. Return aggregated results.

**Response format:**

```json
{
  "query": "tanaka",
  "results": [
    {
      "concept": "guest",
      "found": 3,
      "hits": [
        {
          "id": "uuid-123",
          "name": "Tanaka Yuki",
          "status": "confirmed",
          "highlights": [
            { "field": "name", "snippet": "<mark>Tanaka</mark> Yuki" }
          ],
          "score": 0.95
        }
      ],
      "facets": {
        "status": [
          { "value": "confirmed", "count": 2 },
          { "value": "draft", "count": 1 }
        ]
      }
    },
    {
      "concept": "staff",
      "found": 1,
      "hits": [
        {
          "id": "uuid-456",
          "name": "Tanaka Liaison",
          "highlights": [
            { "field": "name", "snippet": "<mark>Tanaka</mark> Liaison" }
          ],
          "score": 0.88
        }
      ],
      "facets": {}
    }
  ],
  "totalFound": 4,
  "meta": {
    "searchTimeMs": 12,
    "conceptsSearched": ["guest", "staff"]
  }
}
```

**Highlight format:** The search engine returns highlighted snippets with `<mark>` tags around matching terms. The API passes these through to the frontend for rendering.

### Acceptance Criteria

- [ ] `GET /api/search?q=tanaka` returns results from all viewable concepts.
- [ ] Results are grouped by concept with hit counts and relevance scores.
- [ ] Concepts the caller cannot view are excluded from search results.
- [ ] Empty query (`q=`) returns 400.
- [ ] Results respect pagination (`limit` and `page` parameters).
- [ ] Search response includes timing metadata (`searchTimeMs`).
- [ ] Highlights are included for matching fields.

---

## 5. RBAC in Search

### Purpose

Ensure search results never expose data the caller is not authorized to view.

### Detail

**Three levels of RBAC filtering in search:**

**Level 1 -- Concept access:**

Before searching, determine which concepts the caller can view:

```typescript
const searchableConcepts = allSearchableConcepts.filter(
  concept => roleEngine.canPerformAction(roleKey, concept, 'view')
)
```

Only searchable concepts are queried. The search engine never receives a query for a concept the caller cannot access.

**Level 2 -- Data scope (row-level):**

For roles with data scopes (e.g., liaison sees only their assigned guests), the search query includes a filter:

```typescript
const scopeFilter = await roleEngine.buildDataScopeFilter(
  roleKey, conceptKey, userId
)
if (scopeFilter) {
  // Add as a Typesense filter_by clause
  // e.g., filter_by: "assigned_liaison_id:=user-uuid"
}
```

Data scope filters are translated to Typesense `filter_by` expressions. This requires that scope-relevant fields (e.g., `assigned_liaison_id`, `department`) are indexed as filterable fields.

**Level 3 -- Field visibility:**

After retrieving search results, each hit is filtered through `roleEngine.filterRecord()`:

```typescript
const filteredHit = await roleEngine.filterRecord(
  roleKey, conceptKey, hit.document
)
```

Fields the caller cannot see are stripped from the result. If a search match is in a field the caller cannot see, the hit still appears (the record matched), but the matching field is removed from highlights and the result document.

**Edge case -- invisible match field:** If a guest's dietary restrictions (hidden from volunteers) contain "halal" and a volunteer searches for "halal", the guest record DOES NOT appear in results. The search query is executed only against fields the caller can see. This is enforced by using Typesense's `query_by` parameter to restrict searchable fields per role:

```typescript
const visibleProps = await roleEngine.getVisibleProperties(roleKey, conceptKey)
const queryBy = searchableFields.filter(f => visibleProps.includes(f)).join(',')
```

### Acceptance Criteria

- [ ] Concepts the caller cannot view are excluded from search entirely.
- [ ] Data scope filters restrict results to records within the caller's scope.
- [ ] Field-level filtering removes invisible fields from search results.
- [ ] A search matching a field invisible to the caller does NOT return that record.
- [ ] `query_by` is dynamically set per role to include only visible, searchable fields.
- [ ] An admin role with full access sees all results. A volunteer role sees a restricted subset.

---

## 6. Faceted Search

### Purpose

Enable filtering and drill-down within search results by structured fields.

### Detail

**Facet fields** are concept properties with `type = 'select'`, `type = 'multi_select'`, `type = 'boolean'`, or the system fields `status` and `department`. These are indexed with `facet: true` in the Typesense schema.

**Filter expressions:**

The `filters` query parameter accepts a JSON object:

```json
{
  "status": ["confirmed", "arrived"],
  "department": ["guest_relations"],
  "type": ["JP"]
}
```

This is translated to Typesense filter syntax:

```
filter_by: status:[confirmed,arrived] && department:guest_relations && type:JP
```

**Date range filters:**

```json
{
  "created_at": { "gte": "2026-01-01", "lte": "2026-04-08" }
}
```

Translated to: `filter_by: created_at:>=1735689600 && created_at:<=1744070400`

**Facet counts in response:**

For each concept in the results, the response includes facet counts for all facet-enabled fields. This enables the UI to render filter dropdowns with counts (e.g., "Status: confirmed (12), draft (3), arrived (5)").

### Acceptance Criteria

- [ ] Search results include facet counts for select, multi_select, and boolean fields.
- [ ] Filter expressions narrow search results to matching records only.
- [ ] Date range filters work with `gte` and `lte` operators.
- [ ] Multiple filter values for the same field are ORed (e.g., status = confirmed OR arrived).
- [ ] Multiple filters across fields are ANDed.
- [ ] Facet counts update dynamically as filters are applied.

---

## 7. Autocomplete

### Purpose

Provide as-you-type suggestions for relation fields and global search.

### Detail

**Autocomplete endpoint:** `GET /api/search/autocomplete`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | `string` | Yes | Partial query text. Min 1 character. |
| `concept` | `string` | Yes | Single concept to search within. |
| `field` | `string` | No | Specific field to autocomplete on. Default: primary display field. |
| `limit` | `number` | No | Max suggestions. Default 5, max 20. |
| `excludeIds` | `string` | No | Comma-separated record IDs to exclude (already selected in multi-select). |

**Response:**

```json
{
  "suggestions": [
    { "id": "uuid-123", "text": "Tanaka Yuki", "subtitle": "Sony Music / confirmed" },
    { "id": "uuid-456", "text": "Tanaka Ryo", "subtitle": "Bandai / draft" }
  ]
}
```

**Use cases:**

1. **Global search bar:** User types in the top nav search bar. Autocomplete shows top matches across all viewable concepts.
2. **Relation field autocomplete:** When editing a relation field (e.g., "Assigned Liaison"), the form input queries `GET /api/search/autocomplete?q=tan&concept=staff&field=name` to suggest matching staff members.
3. **Filter value autocomplete:** When typing in a filter input, autocomplete suggests matching values from the faceted field.

**Performance:** Autocomplete queries use Typesense's `search` endpoint with `per_page=5` and `prefix=true` for prefix matching. Target latency: < 30ms.

**RBAC:** Autocomplete respects the same RBAC filtering as full search (Section 5). Users only see suggestions for records they can view.

### Acceptance Criteria

- [ ] Autocomplete returns suggestions within 50ms for datasets under 100,000 documents.
- [ ] Suggestions include a primary text and an optional subtitle for disambiguation.
- [ ] RBAC filtering applies -- suggestions only include records the caller can view.
- [ ] `excludeIds` prevents already-selected records from appearing in suggestions.
- [ ] Prefix matching works (typing "Tan" matches "Tanaka").
- [ ] Typo tolerance works (typing "Tnaka" matches "Tanaka").

---

## 8. Deployment

### Purpose

Define how the search engine runs alongside the API in development and production.

### Detail

**Local development (Docker Compose):**

```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      TYPESENSE_HOST: typesense
      TYPESENSE_PORT: 8108
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY}
    depends_on:
      - typesense

  typesense:
    image: typesense/typesense:27.1
    ports:
      - "8108:8108"
    volumes:
      - typesense-data:/data
    command: >
      --data-dir /data
      --api-key=${TYPESENSE_API_KEY}
      --enable-cors

volumes:
  typesense-data:
```

**Production (Cloud Run sidecar):**

Typesense runs as a sidecar container in the same Cloud Run service as the API:

```yaml
# cloud-run-service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
spec:
  template:
    spec:
      containers:
        - name: api
          image: gcr.io/project/api:latest
          ports:
            - containerPort: 3000
          env:
            - name: TYPESENSE_HOST
              value: localhost
            - name: TYPESENSE_PORT
              value: "8108"
        - name: typesense
          image: typesense/typesense:27.1
          args:
            - --data-dir=/data
            - --api-key=$(TYPESENSE_API_KEY)
          volumeMounts:
            - name: typesense-data
              mountPath: /data
      volumes:
        - name: typesense-data
          emptyDir:
            sizeLimit: 1Gi
```

**Sidecar considerations:**

1. **Data persistence:** Cloud Run sidecars use `emptyDir` volumes, which are ephemeral. When the instance scales down, the search index is lost. On scale-up, the search service triggers a full re-index from Postgres (Section 9).
2. **Memory:** Typesense uses ~50-100MB for convention-scale data (< 100,000 documents total). Cloud Run memory limit should allocate 256MB for the sidecar.
3. **Startup order:** The API container waits for the Typesense health check (`GET /health`) before processing requests.

**API key for Typesense:** Stored in GCP Secret Manager. The key is for internal communication between the API and Typesense sidecar -- it is not exposed to clients.

### Acceptance Criteria

- [ ] Docker Compose starts both API and Typesense with a single `docker compose up`.
- [ ] Cloud Run deployment includes Typesense as a sidecar container.
- [ ] The API connects to Typesense via `localhost:8108` in production.
- [ ] Typesense API key is sourced from Secret Manager, not hardcoded.
- [ ] Typesense health check passes before the API starts accepting requests.
- [ ] Search functions correctly after a cold start (re-index from Postgres).

---

## 9. Re-Index

### Purpose

Define the process for rebuilding the search index from Postgres.

### Detail

**When re-index is needed:**

1. After a cold start (Cloud Run scale-from-zero, sidecar ephemeral storage).
2. After ontology schema changes that affect searchable properties.
3. After a data migration or bulk import.
4. On-demand via admin endpoint for recovery.

**Re-index endpoint:** `POST /api/admin/search/reindex`

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `concept` | `string` | No | Specific concept to re-index. Default: all concepts. |
| `force` | `boolean` | No | Drop and recreate the collection before indexing. Default `false`. |

**Re-index process:**

1. Lock the concept to prevent concurrent re-index operations (advisory lock in Postgres).
2. If `force = true`, drop and recreate the Typesense collection with the current ontology schema.
3. Query Postgres for all active (non-archived) records of the concept, in batches of 500.
4. For each batch, build search documents and upsert into Typesense using the `import` endpoint (bulk upsert, not individual inserts).
5. Update `search_sync_state` with the latest event ID at the time of re-index.
6. Release the advisory lock.
7. Emit `search.reindex_completed` event with concept and document count.

**Startup re-index:**

On application startup, the search service checks if each concept's Typesense collection exists and has documents. If not, it triggers a re-index for that concept. This runs in the background -- the API is available immediately, but search results may be incomplete until re-indexing finishes.

**Performance:** Re-indexing 10,000 records takes approximately 2-3 seconds with batched imports. Full convention dataset (< 100,000 records total across all concepts) re-indexes in under 30 seconds.

### Acceptance Criteria

- [ ] `POST /api/admin/search/reindex` triggers a full re-index from Postgres.
- [ ] Re-index runs in the background; API remains available during re-index.
- [ ] Concurrent re-index requests for the same concept are blocked (advisory lock).
- [ ] Re-index with `force = true` drops and recreates the collection.
- [ ] Full re-index of < 100,000 records completes within 60 seconds.
- [ ] On cold start, missing collections are automatically re-indexed.
- [ ] `search.reindex_completed` event is emitted with document count.

---

## 10. Ontology-Driven Schema Updates

### Purpose

Automatically update search collection schemas when the ontology changes.

### Detail

The search service subscribes to ontology change events:

```typescript
subscribe('ontology_property.created', handleSchemaChange, 800)
subscribe('ontology_property.updated', handleSchemaChange, 800)
subscribe('ontology_property.deleted', handleSchemaChange, 800)
```

**Schema change handling:**

1. When a new searchable property is added to a concept, add the corresponding field to the Typesense collection schema.
2. When a property type changes (e.g., `text` to `select`), update the field type in the schema. This may require a collection drop and re-index if Typesense does not support in-place type changes.
3. When a property is deleted, remove the field from the schema and re-index (Typesense requires re-index for field removal).
4. When a property's `encrypted` flag changes to `true`, remove the plaintext field from the index and re-index.

**Schema diff logic:**

```typescript
function computeSchemaDiff(
  currentSchema: CollectionSchema,
  ontologyProperties: ReadonlyArray<OntologyProperty>
): SchemaDiff {
  // Compare current Typesense fields with ontology-derived fields
  // Return: { added: Field[], removed: Field[], typeChanged: Field[] }
}
```

If the diff contains only additions, use Typesense's `PATCH` endpoint to add fields without re-indexing. If the diff contains removals or type changes, trigger a full re-index for the concept.

### Acceptance Criteria

- [ ] Adding a new text property to a concept makes it searchable without manual intervention.
- [ ] Removing a property from the ontology removes it from the search index.
- [ ] Changing a property to `encrypted: true` removes it from the search index and triggers re-index.
- [ ] Schema additions that don't require re-index are applied incrementally.
- [ ] Schema changes that require re-index trigger automatic re-index.

---

## 11. Test Plan

### 11.1 Unit Tests -- Index Sync

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-01 | Record created | `guest.created` event | Document upserted in Typesense `guest` collection |
| U-02 | Record updated | `guest.updated` event | Document updated in Typesense |
| U-03 | Record deleted | `guest.deleted` event | Document removed from Typesense |
| U-04 | Non-searchable concept | Event for concept without search collection | No Typesense operation, no error |
| U-05 | Typesense unavailable | Search engine down during sync | Error logged, event not thrown, `search.sync_failed` emitted |
| U-06 | Encrypted field | Guest record with encrypted `email` | Plaintext email NOT in search index; `email_hmac` indexed |

### 11.2 Unit Tests -- Search API

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-07 | Basic text search | `q=tanaka` | Results from all viewable concepts containing "tanaka" |
| U-08 | Concept-scoped search | `q=tanaka&concepts=guest` | Results only from `guest` collection |
| U-09 | Typo tolerance | `q=tnaka` | Results matching "tanaka" |
| U-10 | Empty query | `q=` | 400 Bad Request |
| U-11 | Pagination | `q=guest&limit=5&page=2` | Second page of results, 5 per page |
| U-12 | Highlights | `q=tanaka` | Results include highlighted snippets with `<mark>` tags |

### 11.3 Unit Tests -- RBAC Filtering

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-13 | Concept-level filter | Volunteer searches, cannot view `admin_settings` | `admin_settings` excluded from results |
| U-14 | Data scope filter | Liaison searches for guests | Only their assigned guests returned |
| U-15 | Field-level filter | Volunteer searches, `dietary_restrictions` hidden | Field not in results, match on hidden field excluded |
| U-16 | Admin full access | Admin searches | All concepts, all records, all fields returned |
| U-17 | query_by restriction | Volunteer searches for dietary term | No results (field not in query_by for volunteer role) |

### 11.4 Unit Tests -- Autocomplete

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-18 | Prefix match | `q=Tan&concept=guest` | Suggestions starting with "Tan" |
| U-19 | Typo tolerance | `q=Tnka&concept=guest` | Suggestions matching "Tanaka" |
| U-20 | Exclude IDs | `excludeIds=uuid-123` | uuid-123 not in suggestions |
| U-21 | RBAC applied | Volunteer autocomplete on `guest` | Only viewable guests suggested |
| U-22 | Limit respected | `limit=3` | At most 3 suggestions |

### 11.5 Integration Tests -- Full Pipeline

| # | Test | Scenario | Expected |
|---|------|----------|----------|
| I-01 | Create and search | Create guest via CRUD API, search by name | Guest appears in search results within 5 seconds |
| I-02 | Update and search | Update guest status, search with status filter | Updated status reflected in search results |
| I-03 | Delete and search | Delete guest, search by name | Guest no longer appears in results |
| I-04 | Cross-concept search | Create guest and staff with same name, search | Results grouped by concept |
| I-05 | Re-index recovery | Drop Typesense collection, trigger re-index | All records re-indexed, search works |
| I-06 | Email search by HMAC | Search for guest by exact email | Guest found via blind index match |
| I-07 | Schema change sync | Add new property to concept, create record with it | New property is searchable |
| I-08 | Faceted search | Search with status filter | Only records with matching status returned; facet counts accurate |

### 11.6 Performance Tests

| Scenario | Target |
|----------|--------|
| Search query (10,000 documents, 5 concepts) | < 50ms response time |
| Autocomplete (10,000 documents) | < 30ms response time |
| Full re-index (10,000 documents) | < 10 seconds |
| Full re-index (100,000 documents) | < 60 seconds |
| Index sync latency (single event) | Document searchable within 2 seconds |
| Concurrent search (50 users) | p95 < 100ms |

### 11.7 Error Handling Tests

| Scenario | Expected |
|----------|----------|
| Typesense container crashed | API returns 503 for search, all other endpoints unaffected |
| Typesense returns error on index | Error logged, `search.sync_failed` emitted, event bus unblocked |
| Invalid filter expression | 400 with descriptive error message |
| Search for XSS payload | Query sanitized, no script execution in highlights |
| Concurrent re-index attempts | Second attempt blocked by advisory lock, returns 409 |

### Acceptance Criteria (Test Plan)

- [ ] All unit tests pass with >= 80% coverage on the search service.
- [ ] Integration tests verify end-to-end flow from domain write to searchable document.
- [ ] Performance tests confirm sub-50ms search latency at convention scale.
- [ ] RBAC tests verify no unauthorized data appears in search results.
- [ ] All tests run against a real Typesense instance (Docker, per `data/integration-testing.md` pattern).
- [ ] Error handling tests confirm search engine failure does not cascade to the API or event bus.
