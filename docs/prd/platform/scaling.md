# Scaling Strategy

> Firebase Cloud Functions → Cloud Run + Redis + Pub/Sub. Scales to zero between conventions ($0 off-season).
> Handles 100+ concurrent users during convention weekend. Single GCP project, ~$50-80/month active, ~$15-20 idle.

---

## Overview

The platform has a unique scaling profile: near-zero usage for months, then intense usage during a 3-day convention weekend with 50-100+ concurrent staff. The infrastructure must scale to zero (cost nothing off-season) while handling peak load without degradation.

---

## Full Specification

### 1. Compute Evolution

**Purpose:** Define the migration from Cloud Functions to Cloud Run.

| Aspect | Cloud Functions (current) | Cloud Run (target) |
|--------|--------------------------|---------------------|
| Cold start | 10-30 seconds | ~2 seconds |
| Min instances | Cannot set to 0 with warm | 0 (true scale-to-zero) |
| Max instances | Auto | Configurable (10) |
| Concurrency | 1 request per instance | 80 requests per instance |
| Container | Managed (Node 20) | Custom Dockerfile |
| WebSocket | Not supported | Supported (future real-time) |
| Cost at idle | ~$0 (but cold starts) | $0 (true zero) |

**Migration:** Package the Express app in a Dockerfile. Deploy to Cloud Run. Update Firebase Hosting rewrites to proxy to Cloud Run instead of Cloud Functions.

**Acceptance Criteria:**
- [ ] API responds within 200ms p95 under 50 concurrent users
- [ ] Cold start < 3 seconds
- [ ] Zero running instances when no requests for 15 minutes
- [ ] No changes to API routes or client code

### 2. Cache Layer

**Purpose:** Define the Redis caching strategy.

| Aspect | In-Memory (current) | Redis (target) |
|--------|---------------------|----------------|
| Scope | Per-instance (diverges) | Shared across all instances |
| Persistence | Lost on restart | Survives restarts |
| TTL | 5 minutes | 5 minutes (configurable) |
| Invalidation | reloadOntology() clears local | Pub/Sub invalidation to all instances |

**Redis instance:** Memorystore Basic tier, 1GB, ~$35/month.

**Cache key structure:**
- `ontology:cache` — full OntologyCache
- `form:{conceptKey}` — per-concept FormConfig
- `views:{conceptKey}` — per-concept ViewConfig[]
- `pages` — all PageConfigs
- `rbac:permissions` — all Permission records
- `rbac:data_scopes` — all DataScope records
- `user_role:{email}` — per-user role resolution

**Acceptance Criteria:**
- [ ] Cache hit < 1ms
- [ ] Cache miss + Postgres load < 100ms
- [ ] Invalidation propagates to all instances < 5 seconds

### 3. Event Delivery

**Purpose:** Define the Pub/Sub strategy for cross-service events.

**Current:** In-process event bus (handlers run in the same Cloud Function/Run instance).

**Target:** Dual delivery — in-process for same-service handlers (workflows, audit logging) + Cloud Pub/Sub for cross-service consumers (internal apps, webhook delivery).

```
Domain event emitted
  ├── In-process: workflow executor, audit logger
  └── Pub/Sub topic: domain-events
       ├── Subscription: warehouse-app (filtered to equipment.*)
       ├── Subscription: calendar-sync (filtered to schedule.*)
       └── Subscription: webhook-delivery (delivers to registered webhooks)
```

**Acceptance Criteria:**
- [ ] In-process handlers unaffected by Pub/Sub addition
- [ ] External apps receive events within 5 seconds of emission
- [ ] Failed Pub/Sub delivery retried with exponential backoff

### 4. Database Scaling

**Purpose:** Define Postgres scaling for convention weekend.

**Cloud SQL configuration:**
- Dev: db-f1-micro (shared CPU, 0.6GB RAM, $8/month)
- Production: db-custom-2-4096 (2 vCPU, 4GB RAM, ~$30/month)
- Connection pooling: PgBouncer or built-in Cloud SQL connection pooler
- Max connections: 100 (shared across all Cloud Run instances)
- Read replicas: not needed at this scale

**Query performance targets:**
- Simple CRUD: < 10ms
- Filtered list with RBAC scoping: < 50ms
- Dashboard aggregation: < 200ms
- Full ontology load: < 100ms

**Acceptance Criteria:**
- [ ] 50 concurrent users with < 50ms p95 query time
- [ ] No connection exhaustion under peak load
- [ ] Automated backups enabled with 7-day retention

### 5. Cost Model

**Purpose:** Project infrastructure costs.

| Component | Off-Season | Con Month | Annual |
|-----------|------------|-----------|--------|
| Cloud Run | $0 | $5-15 | ~$20 |
| Cloud SQL | $8/mo | $30/mo | ~$130 |
| Redis | $0 (off) / $35 (on) | $35 | ~$140 |
| Storage | < $1 | < $1 | ~$10 |
| Firebase | Free | Free | $0 |
| Pub/Sub | $0 | < $1 | ~$5 |
| **Total** | **~$10** | **~$80** | **~$305** |

Redis can be shut down off-season (fall back to in-memory during dev/planning). Cloud SQL can be scaled down to db-f1-micro off-season.

**Acceptance Criteria:**
- [ ] Off-season cost < $15/month
- [ ] Convention month cost < $100/month
- [ ] Cost monitoring alerts at $50 and $100 thresholds

### 6. Test Plan

| Test | Type | What | Acceptance |
|------|------|------|------------|
| Load test | Performance | 50 concurrent users, mixed CRUD | < 200ms p95, no errors |
| Cold start | Performance | Request after 15min idle | < 3s response |
| Cache coherence | Integration | Invalidate on instance A, verify B sees fresh data | < 5s propagation |
| Connection pool | Stress | 100 concurrent DB requests | No connection errors |
| Scale to zero | Infrastructure | No requests for 15min → verify 0 instances | $0 compute cost |
| Pub/Sub delivery | Integration | Emit event → external app receives | < 5s delivery |
