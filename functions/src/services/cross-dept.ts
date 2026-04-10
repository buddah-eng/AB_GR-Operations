/**
 * Cross-Department Collaboration Service
 *
 * Provides aggregated views across departments. Surfaces shared concepts,
 * cross-department dashboard data, and coordination summaries.
 */

import { query } from "../db/client";

// --- Types ---

export interface SharedConcept {
  readonly conceptKey: string;
  readonly conceptName: string;
  readonly pluralName: string;
  readonly ownerScope: string;
  readonly ownerDepartment: string | null;
  readonly propertyCount: number;
}

export interface CrossDeptDashboardData {
  readonly guestsByDepartment: ReadonlyArray<DepartmentCount>;
  readonly scheduleByDepartment: ReadonlyArray<DepartmentCount>;
  readonly staffByDepartment: ReadonlyArray<DepartmentCount>;
  readonly upcomingEvents: ReadonlyArray<UpcomingEvent>;
  readonly overdueItems: number;
  readonly totalGuests: number;
  readonly totalStaff: number;
  readonly totalScheduleEvents: number;
}

export interface DepartmentCount {
  readonly department: string;
  readonly count: number;
}

export interface UpcomingEvent {
  readonly id: string;
  readonly name: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly department: string | null;
  readonly venueName: string | null;
}

// --- Get shared concepts ---

export async function getSharedConcepts(): Promise<ReadonlyArray<SharedConcept>> {
  const result = await query(
    `SELECT
       oc.key AS concept_key,
       oc.name AS concept_name,
       oc.plural_name,
       oc.owner_scope,
       oc.owner_department,
       COUNT(op.id) AS property_count
     FROM ontology_concepts oc
     LEFT JOIN ontology_properties op
       ON op.concept_key = oc.key AND op.status = 'active'
     WHERE oc.status = 'active'
       AND oc.owner_scope = 'org'
     GROUP BY oc.key, oc.name, oc.plural_name, oc.owner_scope, oc.owner_department
     ORDER BY oc.name ASC`
  );

  return result.rows.map((row) => ({
    conceptKey: row.concept_key as string,
    conceptName: row.concept_name as string,
    pluralName: row.plural_name as string,
    ownerScope: row.owner_scope as string,
    ownerDepartment: (row.owner_department as string) ?? null,
    propertyCount: parseInt(String(row.property_count), 10),
  }));
}

// --- Get cross-department dashboard data ---

export async function getCrossDeptDashboardData(): Promise<CrossDeptDashboardData> {
  // Run all queries in parallel for performance
  const [
    guestsByDeptResult,
    scheduleByDeptResult,
    staffByDeptResult,
    upcomingEventsResult,
    overdueResult,
    totalGuestsResult,
    totalStaffResult,
    totalEventsResult,
  ] = await Promise.all([
    query(
      `SELECT COALESCE(department, 'unassigned') AS department, COUNT(*) AS count
       FROM guests WHERE NOT archived
       GROUP BY department ORDER BY count DESC`
    ),
    query(
      `SELECT COALESCE(properties->>'department', 'unassigned') AS department, COUNT(*) AS count
       FROM schedule_events WHERE NOT archived
       GROUP BY properties->>'department' ORDER BY count DESC`
    ),
    query(
      `SELECT COALESCE(department, 'unassigned') AS department, COUNT(*) AS count
       FROM staff WHERE NOT archived
       GROUP BY department ORDER BY count DESC`
    ),
    query(
      `SELECT se.id, se.name, se.start_time, se.end_time,
              se.properties->>'department' AS department,
              v.name AS venue_name
       FROM schedule_events se
       LEFT JOIN venues v ON v.id = se.venue_id
       WHERE NOT se.archived
         AND se.start_time > now()
       ORDER BY se.start_time ASC
       LIMIT 10`
    ),
    query(
      `SELECT COUNT(*) FROM prep_items
       WHERE NOT archived AND status != 'complete' AND due_date < now()`
    ),
    query("SELECT COUNT(*) FROM guests WHERE NOT archived"),
    query("SELECT COUNT(*) FROM staff WHERE NOT archived"),
    query("SELECT COUNT(*) FROM schedule_events WHERE NOT archived"),
  ]);

  return {
    guestsByDepartment: guestsByDeptResult.rows.map(toDeptCount),
    scheduleByDepartment: scheduleByDeptResult.rows.map(toDeptCount),
    staffByDepartment: staffByDeptResult.rows.map(toDeptCount),
    upcomingEvents: upcomingEventsResult.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      startTime: row.start_time
        ? (row.start_time as Date).toISOString()
        : null,
      endTime: row.end_time
        ? (row.end_time as Date).toISOString()
        : null,
      department: (row.department as string) ?? null,
      venueName: (row.venue_name as string) ?? null,
    })),
    overdueItems: parseInt(String(overdueResult.rows[0].count), 10),
    totalGuests: parseInt(String(totalGuestsResult.rows[0].count), 10),
    totalStaff: parseInt(String(totalStaffResult.rows[0].count), 10),
    totalScheduleEvents: parseInt(String(totalEventsResult.rows[0].count), 10),
  };
}

// --- Helper ---

function toDeptCount(row: Record<string, unknown>): DepartmentCount {
  return {
    department: (row.department as string) ?? "unassigned",
    count: parseInt(String(row.count), 10),
  };
}
