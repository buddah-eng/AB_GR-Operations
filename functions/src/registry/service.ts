/**
 * Year-over-Year Registry Service
 *
 * Manages persistent guest identity across convention years.
 * Provides lookup, pre-population, archive, and analytics operations.
 */

import { query, withTransaction } from "../db/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuestRegistryRecord {
  readonly [key: string]: unknown;
  id: string;
  canonical_name: string;
  email: string | null;
  external_ids: Record<string, unknown>;
  first_year: number;
  last_year: number | null;
  total_visits: number;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateRegistryEntryData {
  canonical_name: string;
  email?: string;
  first_year: number;
  last_year?: number;
  total_visits?: number;
  properties?: Record<string, unknown>;
}

export interface ArchiveSummary {
  registryUpdated: number;
  guestsArchived: number;
}

export interface ReturnRateRow {
  readonly [key: string]: unknown;
  department: string;
  total_guests: number;
  returning_guests: number;
  return_rate_pct: number | null;
}

export interface FrequentGuestRow {
  readonly [key: string]: unknown;
  id: string;
  canonical_name: string;
  email: string | null;
  total_visits: number;
  first_year: number;
  last_year: number | null;
}

export interface YoyGrowthRow {
  readonly [key: string]: unknown;
  convention_year: number;
  total_guests: number;
  growth: number | null;
  growth_pct: number | null;
}

export interface NewVsReturningResult {
  newCount: number;
  returningCount: number;
  total: number;
}

export interface CohortRow {
  readonly [key: string]: unknown;
  cohort_year: number;
  attended_year: number;
  guests_in_cohort: number;
}

// ---------------------------------------------------------------------------
// Guest Registry — Lookups
// ---------------------------------------------------------------------------

/**
 * Find a guest registry record by exact email match.
 */
export async function findGuestByEmail(
  email: string
): Promise<GuestRegistryRecord | null> {
  const result = await query<GuestRegistryRecord>(
    `SELECT * FROM guest_registry WHERE email = $1 LIMIT 1`,
    [email]
  );
  return result.rows[0] ?? null;
}

/**
 * Fuzzy lookup by canonical_name (case-insensitive ILIKE).
 */
export async function findGuestByName(
  name: string
): Promise<GuestRegistryRecord[]> {
  const result = await query<GuestRegistryRecord>(
    `SELECT * FROM guest_registry WHERE canonical_name ILIKE $1`,
    [`%${name}%`]
  );
  return result.rows;
}

/**
 * Find guests whose last_year >= the given lookback year.
 */
export async function getReturningGuests(
  lookbackYear: number
): Promise<GuestRegistryRecord[]> {
  const result = await query<GuestRegistryRecord>(
    `SELECT * FROM guest_registry WHERE last_year >= $1 ORDER BY canonical_name`,
    [lookbackYear]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Guest Registry — Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new guest registry entry.
 */
export async function createRegistryEntry(
  data: CreateRegistryEntryData
): Promise<GuestRegistryRecord> {
  const result = await query<GuestRegistryRecord>(
    `INSERT INTO guest_registry (canonical_name, email, first_year, last_year, total_visits, properties)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.canonical_name,
      data.email ?? null,
      data.first_year,
      data.last_year ?? null,
      data.total_visits ?? 1,
      JSON.stringify(data.properties ?? {}),
    ]
  );
  return result.rows[0];
}

/**
 * Link a convention-year guest record to a registry entry.
 */
export async function linkGuestToRegistry(
  guestId: string,
  registryId: string
): Promise<void> {
  await query(
    `UPDATE guests SET registry_id = $1, updated_at = now() WHERE id = $2`,
    [registryId, guestId]
  );
}

// ---------------------------------------------------------------------------
// Pre-population
// ---------------------------------------------------------------------------

/**
 * Pre-populate a new convention year with draft guest records
 * for all returning guests within the lookback window.
 *
 * Returns the count of draft records created.
 */
export async function prePopulateConventionYear(
  year: number,
  lookbackYear: number
): Promise<number> {
  const returning = await query<GuestRegistryRecord>(
    `SELECT * FROM guest_registry WHERE last_year >= $1`,
    [lookbackYear]
  );

  if (returning.rows.length === 0) {
    return 0;
  }

  let created = 0;

  await withTransaction(async (client) => {
    for (const reg of returning.rows) {
      const name = reg.canonical_name;
      const type = (reg.properties as Record<string, unknown>).type ?? null;
      const department = (reg.properties as Record<string, unknown>).department ?? null;
      const company = (reg.properties as Record<string, unknown>).company ?? null;

      await client.query(
        `INSERT INTO guests (name, type, department, company, status, convention_year, registry_id, properties)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)`,
        [name, type, department, company, year, reg.id, JSON.stringify(reg.properties)]
      );
      created += 1;
    }
  });

  return created;
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Archive a completed convention year:
 * 1. Update guest_registry last_year and total_visits for all guests of that year.
 * 2. Mark all convention-year guest records as archived.
 * 3. Return a summary of counts.
 */
export async function archiveConventionYear(
  year: number
): Promise<ArchiveSummary> {
  const registryResult = await query(
    `UPDATE guest_registry gr
     SET last_year = $1,
         total_visits = gr.total_visits + 1,
         updated_at = now()
     FROM guests g
     WHERE g.registry_id = gr.id
       AND g.convention_year = $1
       AND g.archived = false`,
    [year]
  );

  const archiveResult = await query(
    `UPDATE guests SET archived = true, updated_at = now()
     WHERE convention_year = $1 AND archived = false`,
    [year]
  );

  return {
    registryUpdated: registryResult.rowCount ?? 0,
    guestsArchived: archiveResult.rowCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Return rate by department (from guest_registry properties).
 * Uses the properties->>'department' JSONB field since the migration schema
 * stores department in properties.
 */
export async function getReturnRateByDepartment(): Promise<ReturnRateRow[]> {
  const result = await query<ReturnRateRow>(
    `SELECT
       properties->>'department' AS department,
       COUNT(DISTINCT id)::INTEGER AS total_guests,
       COUNT(DISTINCT CASE WHEN total_visits > 1 THEN id END)::INTEGER AS returning_guests,
       ROUND(
         COUNT(DISTINCT CASE WHEN total_visits > 1 THEN id END)::NUMERIC
         / NULLIF(COUNT(DISTINCT id), 0) * 100, 1
       ) AS return_rate_pct
     FROM guest_registry
     GROUP BY properties->>'department'
     ORDER BY return_rate_pct DESC NULLS LAST`
  );
  return result.rows;
}

/**
 * Guests with N or more total visits.
 */
export async function getFrequentGuests(
  minVisits: number
): Promise<FrequentGuestRow[]> {
  const result = await query<FrequentGuestRow>(
    `SELECT id, canonical_name, email, total_visits, first_year, last_year
     FROM guest_registry
     WHERE total_visits >= $1
     ORDER BY total_visits DESC`,
    [minVisits]
  );
  return result.rows;
}

/**
 * Year-over-year attendance growth from the guests table.
 */
export async function getYoyGrowth(): Promise<YoyGrowthRow[]> {
  const result = await query<YoyGrowthRow>(
    `SELECT
       convention_year,
       COUNT(*)::INTEGER AS total_guests,
       (COUNT(*) - LAG(COUNT(*)) OVER (ORDER BY convention_year))::INTEGER AS growth,
       ROUND(
         (COUNT(*)::NUMERIC - LAG(COUNT(*)) OVER (ORDER BY convention_year))
         / NULLIF(LAG(COUNT(*)) OVER (ORDER BY convention_year), 0) * 100, 1
       ) AS growth_pct
     FROM guests
     GROUP BY convention_year
     ORDER BY convention_year`
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// New vs Returning Vendors
// ---------------------------------------------------------------------------

/**
 * Count new vs returning vendors for a given convention year.
 * A vendor is "new" if attendance_count === 1, "returning" if > 1.
 */
export async function getNewVsReturningVendors(
  conventionYear: number
): Promise<NewVsReturningResult> {
  const result = await query<{
    readonly [key: string]: unknown;
    new_count: number;
    returning_count: number;
    total: number;
  }>(
    `SELECT
       COUNT(CASE WHEN attendance_count = 1 THEN 1 END)::INTEGER AS new_count,
       COUNT(CASE WHEN attendance_count > 1 THEN 1 END)::INTEGER AS returning_count,
       COUNT(*)::INTEGER AS total
     FROM vendor_registry
     WHERE convention_year = $1`,
    [conventionYear]
  );

  const row = result.rows[0];
  return {
    newCount: row?.new_count ?? 0,
    returningCount: row?.returning_count ?? 0,
    total: row?.total ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Cohort Analysis
// ---------------------------------------------------------------------------

/**
 * Cohort retention analysis: for each first-attended year (cohort),
 * count how many guests attended each subsequent year.
 */
export async function getCohortAnalysis(): Promise<ReadonlyArray<CohortRow>> {
  const result = await query<CohortRow>(
    `SELECT
       gr.first_year AS cohort_year,
       g.convention_year AS attended_year,
       COUNT(DISTINCT gr.id)::INTEGER AS guests_in_cohort
     FROM guest_registry gr
     JOIN guests g ON g.registry_id = gr.id
     WHERE g.archived = false
     GROUP BY gr.first_year, g.convention_year
     ORDER BY cohort_year, attended_year`
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Duplicate Detection
// ---------------------------------------------------------------------------

/**
 * Detect potential duplicate registry entries for operator review.
 * If email provided, exact match on email first; then fuzzy match on name.
 */
export async function detectDuplicates(
  name: string,
  email?: string
): Promise<ReadonlyArray<GuestRegistryRecord>> {
  if (email) {
    const emailResult = await query<GuestRegistryRecord>(
      `SELECT * FROM guest_registry WHERE email = $1`,
      [email]
    );
    if (emailResult.rows.length > 0) {
      return emailResult.rows;
    }
  }

  const nameResult = await query<GuestRegistryRecord>(
    `SELECT * FROM guest_registry WHERE canonical_name ILIKE $1`,
    [`%${name}%`]
  );
  return nameResult.rows;
}

// ---------------------------------------------------------------------------
// Analytics Snapshot
// ---------------------------------------------------------------------------

/**
 * Create an analytics snapshot table for a completed convention year.
 * Aggregates key metrics into analytics_snapshot_{year}.
 * Part of the archive process (PRD section 5).
 */
export async function createAnalyticsSnapshot(
  conventionYear: number
): Promise<{ snapshotTable: string; rowCount: number }> {
  const tableName = `analytics_snapshot_${conventionYear}`;

  await query(
    `CREATE TABLE IF NOT EXISTS ${tableName} AS
     SELECT
       g.convention_year,
       g.department,
       g.type,
       COUNT(*)::INTEGER AS guest_count,
       COUNT(DISTINCT g.registry_id)::INTEGER AS unique_registry_entries,
       COUNT(CASE WHEN gr.total_visits > 1 THEN 1 END)::INTEGER AS returning_count
     FROM guests g
     LEFT JOIN guest_registry gr ON gr.id = g.registry_id
     WHERE g.convention_year = $1
     GROUP BY g.convention_year, g.department, g.type`,
    [conventionYear]
  );

  const countResult = await query<{ readonly [key: string]: unknown; count: number }>(
    `SELECT COUNT(*)::INTEGER AS count FROM ${tableName}`
  );

  return {
    snapshotTable: tableName,
    rowCount: countResult.rows[0]?.count ?? 0,
  };
}
