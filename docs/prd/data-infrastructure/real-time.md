# Real-Time Updates

> When a guest status changes, other users see it immediately -- not on next page refresh.
> Server-Sent Events (SSE) push domain events to connected clients, filtered by RBAC.
> The event bus subscriber runs at priority 950. No persistent storage -- SSE is ephemeral.
> Single-instance design for convention scale (50-100 users). Redis pub/sub relay for multi-instance (deferred D-001).

---

## Overview

The platform is a multi-user operational tool. During convention weekend, 50-100 staff members work simultaneously across different departments. When a liaison updates a guest's status, the ops lead viewing the same guest on a dashboard should see the change instantly -- not after a manual refresh.

This PRD defines a unidirectional real-time update system using Server-Sent Events (SSE). SSE is chosen over WebSockets because the communication is one-way (server-to-client), the protocol is simpler (HTTP-based, works through proxies and load balancers), and the implementation surface is smaller.

**Dependencies:**
- `core/event-bus.md` -- subscribes to domain events for real-time distribution
- `core/rbac-engine.md` -- filters events before pushing to clients
- `platform/scaling.md` -- single-instance SSE for Phase 1; Redis pub/sub relay for multi-instance

**What this PRD covers:** SSE endpoint, client connection management, event filtering, RBAC enforcement, reconnect/offline resilience, and Vue composable for frontend integration.

**What this PRD does NOT cover:** WebSocket upgrade path (documented as future option). Frontend UI components for displaying real-time updates (covered by UI PRDs). Push notifications to mobile (see `data-infrastructure/notifications.md`).

---

## 1. SSE Endpoint

### Purpose

Define the HTTP endpoint that clients connect to for receiving real-time domain events.

### Detail

**Endpoint:** `GET /api/stream`

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `concepts` | `string` | Yes | Comma-separated concept keys to subscribe to. e.g., `guest,schedule,prep_item` |
| `lastEventId` | `string` | No | Last received event ID for reconnection. Also sent via `Last-Event-ID` header by the browser. |

**Request headers:**

```
Accept: text/event-stream
Authorization: Bearer <firebase-token>
```

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

**Authentication:** The SSE endpoint goes through the same `authMiddleware()` chain as all other endpoints. The user's role and identity are resolved before the connection is established. Unauthenticated requests receive 401.

**Concept validation:** Requested concepts are validated against the ontology. Unknown concept keys are silently ignored (client may subscribe to concepts that don't exist yet). At least one valid concept must be provided, or 400 is returned.

**RBAC gate:** Before registering the connection, verify via `roleEngine.canPerformAction(roleKey, conceptKey, 'view')` for each requested concept. Concepts the user cannot view are silently excluded from the subscription. If all concepts are excluded, return 403.

### Acceptance Criteria

- [ ] `GET /api/stream?concepts=guest,schedule` returns a `text/event-stream` response.
- [ ] Unauthenticated requests return 401.
- [ ] Concepts the user's role cannot view are excluded from the subscription.
- [ ] If all requested concepts are excluded by RBAC, return 403.
- [ ] Unknown concept keys are ignored without error.
- [ ] The endpoint keeps the connection open indefinitely (until client disconnect or server shutdown).

---

## 2. Event Bus Subscriber

### Purpose

Subscribe to domain events and push matching events to connected SSE clients.

### Detail

The real-time service registers a wildcard event bus subscriber on startup:

```typescript
subscribe('*', handleRealtimeDistribution, 950)
```

**Priority 950** places it after notification delivery (900) and before the Pub/Sub bridge (999). Real-time updates are a side effect that should not delay domain processing.

**Handler logic:**

1. Extract `domain` (concept key) from the event.
2. Look up all connected SSE clients subscribed to that concept.
3. For each matching client:
   a. **RBAC filter:** Check if the client's role has `canView` permission for the concept. If not, skip.
   b. **Field filter:** Determine which `changedFields` the client's role can see via `getVisibleProperties()`. Remove fields outside the visibility set.
   c. **Build SSE event:** Construct the event payload with only permitted fields.
   d. **Push to client:** Write the SSE event to the client's response stream.
4. Log the number of clients notified for observability.

**Events NOT distributed in real-time:**

| Event pattern | Reason |
|---------------|--------|
| `notification.*` | Notifications have their own delivery system |
| `event_log.*` | Internal infrastructure events |
| `audit.*` | Audit events are internal-only |

### Acceptance Criteria

- [ ] Subscriber registered at priority 950 with pattern `*`.
- [ ] Domain events matching a client's concept subscription are pushed to that client.
- [ ] Events for non-subscribed concepts are not pushed.
- [ ] `notification.*`, `event_log.*`, and `audit.*` events are excluded.
- [ ] The handler never throws -- errors pushing to a single client do not affect other clients.

---

## 3. RBAC-Filtered Event Delivery

### Purpose

Ensure clients only receive real-time events for records and fields they are authorized to view.

### Detail

**Concept-level filter:**

Before pushing any event, the service checks:

```typescript
const canView = await roleEngine.canPerformAction(
  client.roleKey, event.domain, 'view'
)
if (!canView) return  // skip this client
```

**Data scope filter:**

For roles with data scopes (e.g., liaison sees only their assigned guests), the service checks whether the event's `recordId` is within the client's data scope:

```typescript
const scopeFilter = await roleEngine.buildDataScopeFilter(
  client.roleKey, event.domain, client.userId
)
if (scopeFilter) {
  const inScope = await checkRecordInScope(event.recordId, scopeFilter)
  if (!inScope) return  // skip, record not in client's scope
}
```

**Field-level filter:**

The `changedFields` array in the event is filtered against the client's `visibleProperties`:

```typescript
const visible = await roleEngine.getVisibleProperties(
  client.roleKey, event.domain
)
const filteredChangedFields = event.changedFields?.filter(
  field => visible.includes(field)
)
```

If `filteredChangedFields` is empty after filtering (the update only affected fields this role cannot see), the event is not pushed to the client.

### Acceptance Criteria

- [ ] A volunteer role that cannot view `guest` concept receives no guest events.
- [ ] A liaison scoped to their assigned guests receives events only for those guests.
- [ ] `changedFields` in pushed events contain only fields the client's role can see.
- [ ] An update to a field invisible to the client produces no SSE event for that client.
- [ ] Field filtering uses `getVisibleProperties()` from the RBAC engine -- no hardcoded field lists.

---

## 4. SSE Data Format

### Purpose

Define the wire format for events pushed to clients over the SSE connection.

### Detail

**SSE event format:**

```
id: <event.eventId>
event: domain.update
data: {"concept":"guest","action":"updated","recordId":"uuid-123","changedFields":["status","notes"],"timestamp":"2026-04-08T14:30:00Z"}

```

Each SSE message contains:

| SSE field | Value | Purpose |
|-----------|-------|---------|
| `id` | `event.eventId` (UUID) | Enables `Last-Event-ID` for reconnection |
| `event` | `domain.update` | SSE event type (client filters on this) |
| `data` | JSON payload | Minimal change descriptor |

**JSON payload schema:**

```typescript
interface RealtimeEvent {
  readonly concept: string        // e.g., "guest"
  readonly action: string         // e.g., "updated", "created", "deleted"
  readonly recordId: string       // UUID of the affected record
  readonly changedFields?: ReadonlyArray<string>  // RBAC-filtered field list
  readonly triggeredBy: string    // actor who made the change
  readonly timestamp: string      // ISO 8601
}
```

**Design decision: no full record in payload.** The SSE event carries a change descriptor, not the full record. The client uses the `concept` + `recordId` to fetch the updated record via the standard CRUD API. This avoids:
- Duplicating RBAC field filtering in the SSE payload.
- Sending large records over the stream.
- Stale-data issues from race conditions between SSE delivery and API response.

**Keep-alive ping:**

```
: ping

```

Sent every 30 seconds to prevent proxies and load balancers from closing idle connections. The `:` prefix makes it an SSE comment, ignored by the client's `EventSource` parser.

### Acceptance Criteria

- [ ] SSE events include `id`, `event`, and `data` fields.
- [ ] The `id` field contains the domain event's UUID for reconnection support.
- [ ] Payload is a JSON change descriptor, not the full record.
- [ ] Keep-alive pings are sent every 30 seconds.
- [ ] SSE format is parseable by the browser-native `EventSource` API.

---

## 5. Connection Management

### Purpose

Track connected clients, handle disconnects, and manage connection lifecycle.

### Detail

**Client registry:**

An in-memory `Map` keyed by a connection ID (UUID generated on connect):

```typescript
interface SSEClient {
  readonly connectionId: string
  readonly userId: string
  readonly roleKey: string
  readonly concepts: ReadonlyArray<string>  // subscribed concepts
  readonly response: Response               // Express response object for writing
  readonly connectedAt: Date
  readonly lastEventId?: string             // for reconnection gap-fill
}

const clients: Map<string, SSEClient> = new Map()
```

**Connection lifecycle:**

1. **Connect:** Client sends `GET /api/stream?concepts=...`. Server validates auth and RBAC, creates `SSEClient` entry, writes initial SSE comment (`: connected\n\n`), and begins streaming.
2. **Active:** Events are pushed as they arrive. Keep-alive pings every 30 seconds.
3. **Disconnect:** Client closes the connection (browser tab closed, network loss). Express fires the `close` event on the request. Server removes the client from the registry. No cleanup needed -- SSE connections are stateless.
4. **Server shutdown:** On `SIGTERM`, all connected clients receive a final `event: shutdown` message and the connections are closed gracefully.

**Connection limits:**

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max connections per user | 3 | User may have multiple browser tabs |
| Max total connections | 200 | Convention scale + buffer |
| Max concepts per connection | 20 | Prevent overly broad subscriptions |

When a user exceeds 3 connections, the oldest connection is closed with an `event: replaced` message.

**Metrics (logged, not stored):**

- Active connection count
- Connections per concept
- Events pushed per minute
- Average time between keep-alive and next event

### Acceptance Criteria

- [ ] Client registry tracks all active SSE connections.
- [ ] Disconnected clients are removed from the registry immediately via the `close` event.
- [ ] Users cannot exceed 3 concurrent SSE connections; oldest is replaced.
- [ ] Total connection count cannot exceed 200; new connections return 503 when at capacity.
- [ ] Server shutdown sends a `shutdown` event to all clients before closing.

---

## 6. Reconnection and Offline Resilience

### Purpose

Handle client reconnection after network interruption, delivering missed events.

### Detail

**Browser reconnection:**

The browser-native `EventSource` API automatically reconnects when the connection drops. On reconnect, it sends the `Last-Event-ID` header containing the `id` of the last received SSE event.

**Server-side event buffer:**

The server maintains a circular buffer of the last 1,000 events (per concept) in memory:

```typescript
interface EventBuffer {
  readonly maxSize: number  // 1,000 per concept
  readonly events: Map<string, ReadonlyArray<BufferedEvent>>  // concept -> events
}

interface BufferedEvent {
  readonly eventId: string
  readonly timestamp: string
  readonly payload: RealtimeEvent
}
```

**Reconnection flow:**

1. Client reconnects with `Last-Event-ID: <uuid>`.
2. Server finds the event ID in the buffer.
3. Server replays all events after that ID (for the client's subscribed concepts, RBAC-filtered).
4. After replay, the connection resumes normal streaming.
5. If the event ID is not found in the buffer (too old or buffer rotated), the server sends:
   ```
   event: resync
   data: {"message":"Event history unavailable. Please refresh data.","concepts":["guest","schedule"]}
   ```
   The client then refetches the relevant data via the CRUD API.

**Buffer sizing rationale:** 1,000 events per concept covers approximately 1-2 hours of active convention operation. If a client is disconnected longer than that, a full resync is appropriate.

### Acceptance Criteria

- [ ] Client reconnection with `Last-Event-ID` replays missed events from the buffer.
- [ ] Replayed events are RBAC-filtered for the reconnecting client.
- [ ] Events older than the buffer are not replayed; a `resync` event is sent instead.
- [ ] Buffer holds up to 1,000 events per concept.
- [ ] Reconnection works with the browser-native `EventSource` API without custom client code.

---

## 7. Frontend Integration

### Purpose

Define the Vue composable that manages SSE connections and integrates with Pinia stores.

### Detail

**Composable: `useRealtimeUpdates`**

```typescript
interface UseRealtimeUpdatesOptions {
  readonly concepts: ReadonlyArray<string>
  readonly onEvent?: (event: RealtimeEvent) => void
  readonly autoReconnect?: boolean  // default true
}

interface UseRealtimeUpdatesReturn {
  readonly connected: Ref<boolean>
  readonly lastEvent: Ref<RealtimeEvent | null>
  readonly connectionError: Ref<string | null>
  readonly disconnect: () => void
  readonly reconnect: () => void
}

function useRealtimeUpdates(
  options: UseRealtimeUpdatesOptions
): UseRealtimeUpdatesReturn
```

**Behavior:**

1. On mount, opens an `EventSource` to `/api/stream?concepts=guest,schedule,...`.
2. Listens for `domain.update` events.
3. On receiving an event, dispatches to the relevant Pinia store's `handleRealtimeUpdate(event)` action.
4. Pinia store action either:
   a. Fetches the updated record via the CRUD API and updates the store state (for list views, kanban boards).
   b. Invalidates a cached query, triggering a refetch (for dashboard widgets, aggregates).
5. On `resync` event, refetches all data for the affected concepts.
6. On `shutdown` event, sets `connected = false` and stops reconnection attempts.
7. On component unmount, closes the SSE connection.

**Pinia store integration pattern:**

```typescript
// In a Pinia store
actions: {
  handleRealtimeUpdate(event: RealtimeEvent) {
    if (event.action === 'deleted') {
      // Remove from local state
      return { ...this, items: this.items.filter(i => i.id !== event.recordId) }
    }
    // Fetch updated record and merge into state
    const updated = await api.get(`/api/domains/${event.concept}/${event.recordId}`)
    return {
      ...this,
      items: this.items.map(i => i.id === event.recordId ? updated : i)
    }
  }
}
```

**Connection lifecycle in the component:**

```vue
<script setup>
const { connected, lastEvent, connectionError } = useRealtimeUpdates({
  concepts: ['guest', 'schedule', 'prep_item'],
})
</script>
```

The composable manages its own lifecycle -- no manual connect/disconnect needed in typical usage. The SSE connection is scoped to the component's lifecycle.

### Acceptance Criteria

- [ ] `useRealtimeUpdates` opens an SSE connection on mount and closes it on unmount.
- [ ] Received events are dispatched to the relevant Pinia store.
- [ ] `connected` ref accurately reflects the connection state.
- [ ] `resync` events trigger a full data refetch for affected concepts.
- [ ] Multiple components using the composable with the same concepts share a single SSE connection (connection deduplication).

---

## 8. Scaling Path

### Purpose

Define the upgrade path from single-instance SSE to multi-instance support.

### Detail

**Phase 1 -- Single instance (current target):**

All SSE connections terminate on a single Cloud Run instance. The in-memory client registry and event buffer work correctly because there is only one process. Cloud Run can be configured with `--max-instances=1` for the SSE-handling service, or SSE connections can be sticky to a single instance via session affinity.

**Capacity:** A single Node.js process can maintain 500-1,000 concurrent SSE connections without significant resource usage. Convention scale is 50-100 concurrent users with 1-3 tabs each = 50-300 connections. Well within single-instance capacity.

**Phase 2 -- Multi-instance with Redis pub/sub (deferred D-001):**

When the platform scales beyond single-instance capacity:

1. Domain events are published to a Redis pub/sub channel (`realtime:<concept>`) in addition to the in-memory distribution.
2. Each Cloud Run instance subscribes to Redis pub/sub for all concepts.
3. When a Redis message arrives, the instance checks its local client registry and pushes to matching connected clients.
4. The event buffer moves from in-memory to Redis (using Redis Streams with `MAXLEN` for automatic trimming).

**Migration:** The `handleRealtimeDistribution` function changes from "push to local clients" to "publish to Redis." The per-instance consumer changes from "receive from event bus" to "receive from Redis pub/sub." The SSE endpoint and client-facing behavior remain identical.

**Phase 3 -- WebSocket upgrade (future, not planned):**

If bidirectional communication is needed (e.g., collaborative editing), SSE can be replaced with WebSockets. The composable API (`useRealtimeUpdates`) remains the same -- only the transport layer changes. Cloud Run supports WebSockets natively.

### Acceptance Criteria

- [ ] Phase 1 supports 200 concurrent SSE connections on a single instance.
- [ ] The SSE endpoint and composable API are transport-agnostic -- switching to Redis relay or WebSockets requires no client-side changes.
- [ ] Multi-instance scaling is a server-side implementation change behind the same API surface.

---

## 9. Test Plan

### 9.1 Unit Tests -- SSE Endpoint

| # | Test | Input | Expected |
|---|------|-------|----------|
| U-01 | Valid connection | `GET /api/stream?concepts=guest` with auth | 200, `Content-Type: text/event-stream` |
| U-02 | No auth | `GET /api/stream?concepts=guest` without token | 401 |
| U-03 | No concepts param | `GET /api/stream` | 400 |
| U-04 | All concepts RBAC-denied | Volunteer role, concepts = `admin_settings` | 403 |
| U-05 | Partial RBAC denial | Concepts = `guest,admin_settings`, volunteer role | Connection opens with only `guest` |
| U-06 | Unknown concept | Concepts = `nonexistent` | Silently ignored; if no valid concepts remain, 400 |

### 9.2 Unit Tests -- Event Filtering

| # | Test | Scenario | Expected |
|---|------|----------|----------|
| U-07 | Matching concept | Client subscribed to `guest`, `guest.updated` fires | Event pushed to client |
| U-08 | Non-matching concept | Client subscribed to `guest`, `schedule.updated` fires | Event NOT pushed |
| U-09 | RBAC concept filter | Client role cannot view `guest` | Event NOT pushed |
| U-10 | RBAC data scope filter | Liaison scoped to guest A, event for guest B | Event NOT pushed |
| U-11 | RBAC field filter | Update to `dietary_restrictions` (hidden from volunteer) | Field excluded from `changedFields` |
| U-12 | All fields filtered | Update only to invisible fields | No event pushed to that client |
| U-13 | Excluded event pattern | `notification.sent` event | Not distributed to any client |

### 9.3 Unit Tests -- Connection Management

| # | Test | Scenario | Expected |
|---|------|----------|----------|
| U-14 | Client disconnect | Browser closes tab | Client removed from registry |
| U-15 | Max connections per user | 4th connection from same user | Oldest connection closed with `replaced` event |
| U-16 | Max total connections | 201st connection | 503 Service Unavailable |
| U-17 | Keep-alive ping | 30 seconds of inactivity | SSE comment `: ping` sent |
| U-18 | Server shutdown | `SIGTERM` signal | All clients receive `shutdown` event |

### 9.4 Unit Tests -- Reconnection

| # | Test | Scenario | Expected |
|---|------|----------|----------|
| U-19 | Reconnect with valid Last-Event-ID | Client reconnects with ID in buffer | Missed events replayed |
| U-20 | Reconnect with stale Last-Event-ID | ID not in buffer (too old) | `resync` event sent |
| U-21 | Reconnect without Last-Event-ID | Fresh connection | No replay, streaming starts from now |
| U-22 | Replayed events are RBAC-filtered | Liaison reconnects, missed events include out-of-scope records | Only in-scope events replayed |

### 9.5 Integration Tests -- Full Pipeline

| # | Test | Scenario | Expected |
|---|------|----------|----------|
| I-01 | Guest status update | Staff updates guest status via CRUD API | Connected client subscribed to `guest` receives SSE event within 2 seconds |
| I-02 | Multi-client broadcast | 3 clients subscribed to `guest`, guest updated | All 3 receive the event |
| I-03 | RBAC-filtered broadcast | Volunteer and director both subscribed to `guest` | Director sees all fields in `changedFields`; volunteer sees restricted set |
| I-04 | Client fetches after event | Client receives `guest.updated` event | Client fetches `GET /api/domains/guest/:id` and sees updated data |
| I-05 | Disconnect and reconnect | Client disconnects for 10 seconds, 5 events fire | Client reconnects, receives 5 buffered events |
| I-06 | Multiple concepts | Client subscribes to `guest,schedule` | Receives events for both concepts |

### 9.6 Performance Tests

| Scenario | Target |
|----------|--------|
| 100 concurrent SSE connections | All receive events within 500ms of emission |
| 50 events/second throughput | All connected clients receive all events |
| Connection setup time | SSE connected and streaming within 200ms |
| Keep-alive with 100 idle connections | < 1% CPU utilization |
| Event buffer with 1,000 events | Reconnection replay completes in < 500ms |

### 9.7 Error Handling Tests

| Scenario | Expected |
|----------|----------|
| Event bus handler throws for one client | Other clients still receive the event |
| Client connection stalls (no reads) | Server detects via write error, removes client |
| Invalid JSON in event payload | Skipped with error log, other events unaffected |
| RBAC engine unavailable | Events not pushed (fail-safe), logged |
| Memory pressure (buffer full) | Oldest events evicted, no crash |

### Acceptance Criteria (Test Plan)

- [ ] All unit tests pass with >= 80% coverage on the real-time service.
- [ ] Integration tests verify end-to-end flow from domain write to SSE event in client.
- [ ] Performance tests confirm sub-second delivery at convention scale.
- [ ] Error handling tests confirm no single-client failure affects others.
- [ ] All tests use real SSE connections (not mocked transport).
