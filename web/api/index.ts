/**
 * Vercel Functions — GR-Ops API
 *
 * Connects to Neon Postgres and serves read requests with response
 * transformers that match the frontend's expected field names.
 * Writes are handled client-side in localStorage (demo mode).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

/* ==================================================================== */
/*  Helpers                                                              */
/* ==================================================================== */

function ok(res: VercelResponse, data: unknown): void {
  res.status(200).json({ success: true, data })
}

function err(res: VercelResponse, status: number, message: string): void {
  res.status(status).json({ success: false, error: message })
}

function capitalize(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0')
}

function formatDate(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/* ==================================================================== */
/*  /api/config                                                          */
/* ==================================================================== */

async function handleConfig(res: VercelResponse): Promise<void> {
  try {
    // Build config from live data
    const [rolesResult, venuesResult, propsResult] = await Promise.all([
      pool.query(`SELECT key, name, description, priority FROM roles ORDER BY priority DESC`),
      pool.query(`SELECT id, name, type, capacity FROM venues ORDER BY name`),
      pool.query(
        `SELECT concept_key, key, options FROM ontology_properties
         WHERE status = 'active' AND options IS NOT NULL AND key IN ('department', 'event_type', 'type')
         ORDER BY concept_key, sort_order`
      ),
    ])

    // Extract department options from guest concept properties
    let departments: Record<string, unknown>[] = []
    let eventTypes: Record<string, unknown>[] = []

    for (const row of propsResult.rows) {
      const opts = typeof row.options === 'string' ? JSON.parse(row.options) : row.options
      if (!Array.isArray(opts)) continue

      if (row.concept_key === 'guest' && row.key === 'department') {
        departments = opts.map((o: { value: string; label: string }) => ({
          'Department Name': o.label || o.value,
          department_name: o.label || o.value,
        }))
      }
      if (row.concept_key === 'schedule' && row.key === 'event_type') {
        eventTypes = opts.map((o: { value: string; label: string }) => ({
          'Type Name': o.label || o.value,
          type_name: o.label || o.value,
        }))
      }
    }

    // Fallback if ontology is empty
    if (departments.length === 0) {
      departments = ['Anime', 'Gaming', 'Music', 'Cosplay', 'Panels', 'Artists', 'Industry'].map(
        (d) => ({ 'Department Name': d, department_name: d })
      )
    }
    if (eventTypes.length === 0) {
      eventTypes = ['Panel', 'Autograph Session', 'Photo Op', 'Meal', 'Other'].map(
        (t) => ({ 'Type Name': t, type_name: t })
      )
    }

    const roles = rolesResult.rows.map((r) => ({
      'Role Name': r.name,
      role_name: r.name,
      key: r.key,
      priority: r.priority,
    }))

    const venues = venuesResult.rows.map((v) => ({
      'Venue Name': v.name,
      venue_name: v.name,
      id: v.id,
      type: v.type,
      capacity: v.capacity,
    }))

    ok(res, {
      departments,
      roles,
      eventTypes,
      venues,
      prepTemplates: [],
      constraints: [],
      convention: {
        name: 'Anime Boston 2026',
        startDate: '2026-04-03',
        endDate: '2026-04-05',
        venue: 'Hynes Convention Center',
        logoUrl: '/placeholder-logo.svg',
      },
    })
  } catch (e) {
    // Fallback to defaults if DB fails
    ok(res, {
      departments: ['Anime', 'Gaming', 'Music', 'Cosplay', 'Panels', 'Artists', 'Industry'].map(
        (d) => ({ 'Department Name': d, department_name: d })
      ),
      roles: ['Main Liaison', 'Backup Liaison', 'Interpreter', 'Security Escort', 'Department Head', 'Volunteer'].map(
        (r) => ({ 'Role Name': r, role_name: r })
      ),
      eventTypes: ['Panel', 'Autograph Session', 'Photo Op', 'Meal', 'Other'].map(
        (t) => ({ 'Type Name': t, type_name: t })
      ),
      venues: [],
      prepTemplates: [],
      constraints: [],
      convention: {
        name: 'Anime Boston 2026',
        startDate: '2026-04-03',
        endDate: '2026-04-05',
        venue: 'Hynes Convention Center',
        logoUrl: '/placeholder-logo.svg',
      },
    })
  }
}

/* ==================================================================== */
/*  /api/ontology                                                        */
/* ==================================================================== */

async function handleOntology(res: VercelResponse): Promise<void> {
  try {
    const [concepts, properties, relationships] = await Promise.all([
      pool.query(
        `SELECT key, name AS label, plural_name AS "pluralLabel", icon, description
         FROM ontology_concepts WHERE status = 'active' ORDER BY key`
      ),
      pool.query(
        `SELECT concept_key, key, label, type, required, sort_order, options, placeholder, description
         FROM ontology_properties WHERE status = 'active' ORDER BY concept_key, sort_order`
      ),
      pool.query(
        `SELECT source_concept_key, target_concept_key, key, label, cardinality, inverse_key
         FROM ontology_relationships WHERE status = 'active'`
      ),
    ])

    const propMap = new Map<string, unknown[]>()
    for (const p of properties.rows) {
      const arr = propMap.get(p.concept_key) ?? []
      // Parse options if stored as string
      let parsedOptions = p.options
      if (typeof parsedOptions === 'string') {
        try { parsedOptions = JSON.parse(parsedOptions) } catch { /* keep as-is */ }
      }
      arr.push({
        key: p.key,
        label: p.label,
        type: p.type,
        required: p.required,
        sortOrder: p.sort_order,
        options: parsedOptions,
        placeholder: p.placeholder,
        description: p.description,
      })
      propMap.set(p.concept_key, arr)
    }

    const relMap = new Map<string, unknown[]>()
    for (const r of relationships.rows) {
      const arr = relMap.get(r.source_concept_key) ?? []
      arr.push({
        key: r.key,
        label: r.label,
        targetConcept: r.target_concept_key,
        cardinality: r.cardinality,
        inverseKey: r.inverse_key,
      })
      relMap.set(r.source_concept_key, arr)
    }

    const enriched = concepts.rows.map((c: Record<string, unknown>) => ({
      ...c,
      properties: propMap.get(c.key as string) ?? [],
      relationships: relMap.get(c.key as string) ?? [],
    }))

    ok(res, { version: '1.0.0', concepts: enriched })
  } catch (e) {
    err(res, 500, `Ontology load failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  /api/visualization/graph                                             */
/* ==================================================================== */

async function handleVisualizationGraph(res: VercelResponse): Promise<void> {
  try {
    const [concepts, relationships] = await Promise.all([
      pool.query(
        `SELECT key, name, plural_name, icon, description
         FROM ontology_concepts WHERE status = 'active' ORDER BY key`
      ),
      pool.query(
        `SELECT id, source_concept_key, target_concept_key, key, label, cardinality
         FROM ontology_relationships WHERE status = 'active'`
      ),
    ])

    const nodes = concepts.rows.map((c: Record<string, unknown>) => ({
      id: `concept-${c.key}`,
      type: 'concept',
      label: String(c.name),
      sourceId: String(c.key),
      sourceTable: 'ontology_concepts',
      properties: {
        icon: c.icon,
        description: c.description,
        pluralName: c.plural_name,
      },
    }))

    const edges = relationships.rows.map((r: Record<string, unknown>) => ({
      id: `rel-${r.id}`,
      type: 'relationship',
      sourceNodeId: `concept-${r.source_concept_key}`,
      targetNodeId: `concept-${r.target_concept_key}`,
      label: String(r.label),
      properties: {
        key: r.key,
        cardinality: r.cardinality,
      },
    }))

    ok(res, {
      nodes,
      edges,
      regions: [],
      metadata: {
        generatedAt: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        version: '1.0.0',
      },
    })
  } catch (e) {
    err(res, 500, `Visualization graph failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Action: getGuestList                                                 */
/* ==================================================================== */

async function handleGetGuestList(res: VercelResponse): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT
        g.id,
        g.name,
        g.type,
        g.department,
        g.status,
        g.company,
        g.properties,
        COALESCE(pc.staff_count, 0) AS staff_count,
        COALESCE(pr.total, 0)      AS prep_total,
        COALESCE(pr.completed, 0)  AS prep_completed
      FROM guests g
      LEFT JOIN (
        SELECT guest_id, COUNT(*)::int AS staff_count
        FROM pairings
        GROUP BY guest_id
      ) pc ON pc.guest_id = g.id
      LEFT JOIN (
        SELECT
          guest_id,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'complete')::int AS completed
        FROM prep_items
        GROUP BY guest_id
      ) pr ON pr.guest_id = g.id
      ORDER BY g.name
    `)

    const guests = result.rows.map((r) => {
      const props = r.properties || {}
      const prepTotal = Number(r.prep_total)
      const prepCompleted = Number(r.prep_completed)
      const prepPercent = prepTotal > 0 ? Math.round((prepCompleted / prepTotal) * 100) : 0

      return {
        guestId: r.id,
        id: r.id,
        name: r.name,
        type: r.type,
        department: r.department,
        status: capitalize(r.status),
        company: r.company || '',
        interpreterRequired: Boolean(props.interpreter_required),
        bio: props.bio || '',
        staffCount: Number(r.staff_count),
        prepPercent,
        prepTotal,
        prepComplete: prepCompleted,
        rowVersion: 0,
      }
    })

    ok(res, guests)
  } catch (e) {
    err(res, 500, `Guest list failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Action: getGuestDetail                                               */
/* ==================================================================== */

async function handleGetGuestDetail(res: VercelResponse, guestId: string): Promise<void> {
  try {
    const guestResult = await pool.query('SELECT * FROM guests WHERE id = $1', [guestId])
    if (guestResult.rows.length === 0) {
      err(res, 404, 'Guest not found')
      return
    }

    const g = guestResult.rows[0]
    const props = g.properties || {}

    // Build guest record with display-name keys the frontend expects
    const guest: Record<string, unknown> = {
      'Guest ID': g.id,
      id: g.id,
      'Guest Name': g.name,
      name: g.name,
      'Guest Type': g.type,
      type: g.type,
      Department: g.department,
      department: g.department,
      Status: capitalize(g.status),
      status: capitalize(g.status),
      'Company/Affiliation': g.company || '',
      company: g.company || '',
      'Interpreter Required': props.interpreter_required ? 'Yes' : 'No',
      interpreterRequired: Boolean(props.interpreter_required),
      'Research Links': props.research_links || '',
      'Special Handling Notes': props.special_handling || '',
      bio: props.bio || '',
      dietary: props.dietary || '',
      pronouns: props.pronouns || '',
      row_version: 0,
    }

    // Pairings with staff details
    const pairingsResult = await pool.query(
      `SELECT p.id, p.guest_id, p.staff_id, p.role, p.properties,
              s.name AS staff_name, s.email AS staff_email
       FROM pairings p
       LEFT JOIN staff s ON s.id = p.staff_id
       WHERE p.guest_id = $1`,
      [guestId]
    )
    const pairings = pairingsResult.rows.map((p) => ({
      pairingId: p.id,
      staffId: p.staff_id,
      staffName: p.staff_name || '',
      staffEmail: p.staff_email || '',
      role: p.role,
      rowVersion: 0,
    }))

    // Schedule events via junction table
    const scheduleResult = await pool.query(
      `SELECT se.id, se.name, se.event_type, se.start_time, se.end_time, se.status,
              se.venue_id, se.properties, v.name AS venue_name
       FROM schedule_events se
       INNER JOIN guest_schedule_events gse ON gse.schedule_event_id = se.id
       LEFT JOIN venues v ON v.id = se.venue_id
       WHERE gse.guest_id = $1
       ORDER BY se.start_time`,
      [guestId]
    )
    const schedule = scheduleResult.rows.map((ev) => ({
      'Event ID': ev.id,
      eventId: ev.id,
      Activity: ev.name,
      activity: ev.name,
      'Event Type': ev.event_type,
      eventType: ev.event_type,
      Date: formatDate(ev.start_time),
      date: formatDate(ev.start_time),
      'Start Time': formatTime(ev.start_time),
      startTime: formatTime(ev.start_time),
      'End Time': formatTime(ev.end_time),
      endTime: formatTime(ev.end_time),
      Venue: ev.venue_name || '',
      venue: ev.venue_name || '',
      Status: capitalize(ev.status || 'draft'),
      status: capitalize(ev.status || 'draft'),
    }))

    // Prep items
    const prepResult = await pool.query(
      `SELECT id, name, status, due_date, properties
       FROM prep_items WHERE guest_id = $1 ORDER BY due_date`,
      [guestId]
    )
    const prepTracker = prepResult.rows.map((p) => {
      const pProps = p.properties || {}
      const statusMap: Record<string, string> = {
        complete: 'Complete',
        in_progress: 'In Progress',
        incomplete: 'Incomplete',
        not_started: 'Incomplete',
      }
      return {
        'Prep ID': p.id,
        prep_id: p.id,
        Item: p.name,
        item: p.name,
        Status: statusMap[p.status] || capitalize(p.status),
        status: statusMap[p.status] || capitalize(p.status),
        'Due Date': p.due_date ? formatDate(p.due_date) : '',
        guestName: pProps.guest_name || g.name,
        owner: pProps.owner || '',
        row_version: 0,
      }
    })

    // Travel / transport
    const travelResult = await pool.query(
      `SELECT id, booking_type, status, pickup_location, dropoff_location,
              scheduled_time, driver_name, vehicle_info, flight_number, properties
       FROM transport_bookings WHERE guest_id = $1 ORDER BY scheduled_time`,
      [guestId]
    )
    const travel = travelResult.rows.map((t) => ({
      id: t.id,
      'Travel Type': capitalize(t.booking_type),
      'Booking Type': capitalize(t.booking_type),
      bookingType: t.booking_type,
      Status: capitalize(t.status || 'pending'),
      status: capitalize(t.status || 'pending'),
      'Pickup Location': t.pickup_location || '',
      'Dropoff Location': t.dropoff_location || '',
      'Scheduled Time': t.scheduled_time ? new Date(t.scheduled_time).toISOString() : '',
      'Departure Date': t.scheduled_time ? formatDate(t.scheduled_time) : '',
      'Departure Time': t.scheduled_time ? formatTime(t.scheduled_time) : '',
      'Arrival Date': t.scheduled_time ? formatDate(t.scheduled_time) : '',
      'Arrival Time': t.scheduled_time ? formatTime(t.scheduled_time) : '',
      Carrier: '',
      'Flight/Route': t.flight_number || '',
      'Confirmation Number': '',
      'Driver Name': t.driver_name || '',
      'Vehicle Info': t.vehicle_info || '',
    }))

    ok(res, {
      guest,
      schedule,
      travel,
      accommodations: [],
      dietary: [],
      autographs: [],
      prepTracker,
      pairings,
      violations: [],
    })
  } catch (e) {
    err(res, 500, `Guest detail failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Action: getScheduleList                                              */
/* ==================================================================== */

async function handleGetScheduleList(res: VercelResponse): Promise<void> {
  try {
    // Each event can have multiple guests via junction table.
    // We return one row per guest-event combination so the timeline can plot
    // each guest independently. For events with multiple guests, we pick
    // the first guest as the primary row and also emit additional rows.
    const result = await pool.query(`
      SELECT
        se.id,
        se.name,
        se.event_type,
        se.start_time,
        se.end_time,
        se.status,
        se.properties,
        v.name AS venue_name,
        gse.guest_id,
        g.name AS guest_name
      FROM schedule_events se
      LEFT JOIN venues v ON v.id = se.venue_id
      LEFT JOIN guest_schedule_events gse ON gse.schedule_event_id = se.id
      LEFT JOIN guests g ON g.id = gse.guest_id
      ORDER BY se.start_time, g.name
    `)

    const events = result.rows.map((r) => ({
      eventId: r.id,
      id: r.id,
      activity: r.name,
      eventType: r.event_type,
      date: formatDate(r.start_time),
      startTime: formatTime(r.start_time),
      endTime: formatTime(r.end_time),
      venue: r.venue_name || '',
      guestId: r.guest_id || '',
      guestName: r.guest_name || '',
      status: capitalize(r.status || 'draft'),
      description: '',
      rowVersion: 0,
    }))

    ok(res, events)
  } catch (e) {
    err(res, 500, `Schedule list failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Action: getPrepItems                                                 */
/* ==================================================================== */

async function handleGetPrepItems(res: VercelResponse): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT
        pi.id,
        pi.name,
        pi.status,
        pi.due_date,
        pi.guest_id,
        pi.properties,
        g.name AS guest_name
      FROM prep_items pi
      LEFT JOIN guests g ON g.id = pi.guest_id
      ORDER BY pi.due_date, g.name
    `)

    const statusMap: Record<string, string> = {
      complete: 'Complete',
      in_progress: 'In Progress',
      incomplete: 'Incomplete',
      not_started: 'Incomplete',
    }

    const items = result.rows.map((r) => {
      const props = r.properties || {}
      return {
        id: r.id,
        label: r.name,
        guestName: r.guest_name || props.guest_name || '',
        guestId: r.guest_id || '',
        dueDate: r.due_date ? formatDate(r.due_date) : '',
        status: statusMap[r.status] || capitalize(r.status),
        owner: props.owner || '',
      }
    })

    ok(res, items)
  } catch (e) {
    err(res, 500, `Prep items failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Action: getStaffList                                                 */
/* ==================================================================== */

async function handleGetStaffList(res: VercelResponse): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT id, name, email, role_key, department, phone, properties
      FROM staff
      ORDER BY name
    `)

    const staffList = result.rows.map((r) => {
      const props = r.properties || {}
      return {
        staffId: r.id,
        id: r.id,
        'Staff ID': r.id,
        'Staff Name': r.name,
        name: r.name,
        email: r.email,
        role: capitalize(r.role_key),
        department: r.department,
        phone: r.phone || '',
        lineId: '',
        availability: props.availability ? capitalize(String(props.availability)) : '',
        reportsTo: '',
        rowVersion: 0,
      }
    })

    ok(res, staffList)
  } catch (e) {
    err(res, 500, `Staff list failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Action: getDashboardData                                             */
/* ==================================================================== */

async function handleDashboard(res: VercelResponse): Promise<void> {
  try {
    const [guestsRes, prepRes, scheduleRes, staffRes, pairingsRes] = await Promise.all([
      pool.query('SELECT id, name, status, department, properties FROM guests'),
      pool.query('SELECT id, status, guest_id, due_date FROM prep_items'),
      pool.query(`
        SELECT se.id, se.name, se.event_type, se.start_time, se.end_time, se.status,
               se.properties, v.name AS venue_name, gse.guest_id, g.name AS guest_name
        FROM schedule_events se
        LEFT JOIN venues v ON v.id = se.venue_id
        LEFT JOIN guest_schedule_events gse ON gse.schedule_event_id = se.id
        LEFT JOIN guests g ON g.id = gse.guest_id
        ORDER BY se.start_time
      `),
      pool.query('SELECT id FROM staff'),
      pool.query('SELECT id, guest_id, staff_id, role FROM pairings'),
    ])

    const guestRows = guestsRes.rows
    const prepRows = prepRes.rows
    const scheduleRows = scheduleRes.rows
    const pairingRows = pairingsRes.rows

    // Guest stats
    const byStatus: Record<string, number> = {}
    const byDepartment: Record<string, number> = {}
    for (const g of guestRows) {
      const label = capitalize(g.status || 'unknown')
      byStatus[label] = (byStatus[label] ?? 0) + 1
      const dept = g.department || 'Unknown'
      byDepartment[dept] = (byDepartment[dept] ?? 0) + 1
    }

    const confirmedStatuses = ['confirmed', 'arrived', 'attending', 'travel_arranged']
    const guestConfirmed = guestRows.filter((g) =>
      confirmedStatuses.includes(String(g.status))
    ).length

    // Prep stats
    const prepCompleted = prepRows.filter((p) => p.status === 'complete').length
    const prepTotal = prepRows.length
    const prepPercent = prepTotal > 0 ? Math.round((prepCompleted / prepTotal) * 100) : 0
    const prepOverdue = prepRows.filter((p) =>
      p.status !== 'complete' && p.due_date && new Date(p.due_date) < new Date()
    ).length
    const prepInProgress = prepRows.filter((p) => p.status === 'in_progress').length

    // Schedule stats
    const byType: Record<string, number> = {}
    const seenEvents = new Set<string>()
    for (const ev of scheduleRows) {
      if (!seenEvents.has(ev.id)) {
        seenEvents.add(ev.id)
        const t = ev.event_type || 'Other'
        byType[t] = (byType[t] ?? 0) + 1
      }
    }

    // Today's events (convention day 1: Apr 3 2026)
    const todayStr = '2026-04-03'
    const todayEvents = scheduleRows
      .filter((ev) => {
        const evDate = formatDate(ev.start_time)
        return evDate === todayStr
      })
      .map((ev) => ({
        eventId: ev.id,
        id: ev.id,
        activity: ev.name,
        name: ev.name,
        eventType: ev.event_type,
        type: ev.event_type,
        startTime: formatTime(ev.start_time),
        endTime: formatTime(ev.end_time),
        guestName: ev.guest_name || '',
        venue: ev.venue_name || '',
        status: capitalize(ev.status || 'draft'),
      }))

    // Staffing coverage
    const liaisonGuests = new Set(
      pairingRows
        .filter((p) => p.role === 'Main Liaison')
        .map((p) => p.guest_id)
    )

    const interpreterGuests = new Set(
      pairingRows
        .filter((p) => p.role === 'Interpreter')
        .map((p) => p.guest_id)
    )

    const coverage = guestRows.map((g) => {
      const props = g.properties || {}
      return {
        guestId: g.id,
        guestName: g.name,
        name: g.name,
        hasLiaison: liaisonGuests.has(g.id),
        interpreterRequired: Boolean(props.interpreter_required),
        hasInterpreter: interpreterGuests.has(g.id),
      }
    })

    ok(res, {
      guests: {
        total: guestRows.length,
        confirmed: guestConfirmed,
        byStatus,
        byDepartment,
      },
      schedule: {
        total: seenEvents.size,
        confirmed: scheduleRows.filter((e) => e.status === 'confirmed').length,
        todayEvents,
        byType,
      },
      prep: {
        total: prepTotal,
        completed: prepCompleted,
        percentComplete: prepPercent,
        percent: prepPercent,
        overdue: prepOverdue,
        inProgress: prepInProgress,
      },
      staffing: {
        total: staffRes.rows.length,
        guestsWithLiaison: liaisonGuests.size,
        coverage,
      },
      violations: { total: 0, items: [], byStatus: { Active: 0 } },
      pendingChanges: { total: 0, items: [] },
    })
  } catch (e) {
    err(res, 500, `Dashboard failed: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Domain list/detail handlers                                          */
/* ==================================================================== */

const TABLE_MAP: Record<string, string> = {
  guest: 'guests',
  guests: 'guests',
  staff: 'staff',
  schedule: 'schedule_events',
  schedule_event: 'schedule_events',
  venue: 'venues',
  venues: 'venues',
  pairing: 'pairings',
  pairings: 'pairings',
  prep: 'prep_items',
  prep_item: 'prep_items',
  transport: 'transport_bookings',
  travel: 'transport_bookings',
}

// Concept-only domains that don't have their own tables
const VIRTUAL_DOMAINS = new Set(['dietary', 'accommodations', 'autographs'])

const SAFE_TABLES = new Set(Object.values(TABLE_MAP))

async function handleDomainList(res: VercelResponse, concept: string): Promise<void> {
  // Virtual domains return empty array
  if (VIRTUAL_DOMAINS.has(concept)) {
    ok(res, [])
    return
  }

  const table = TABLE_MAP[concept]
  if (!table || !SAFE_TABLES.has(table)) {
    err(res, 404, `Unknown concept: ${concept}`)
    return
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id LIMIT 500`)

    // Apply transforms based on table
    if (table === 'transport_bookings') {
      const transformed = result.rows.map((r) => {
        const props = r.properties || {}
        return {
          id: r.id,
          guestId: r.guest_id,
          guestName: props.guest_name || '',
          bookingType: r.booking_type,
          'Travel Type': capitalize(r.booking_type),
          status: capitalize(r.status || 'pending'),
          pickupLocation: r.pickup_location || '',
          dropoffLocation: r.dropoff_location || '',
          scheduledTime: r.scheduled_time ? new Date(r.scheduled_time).toISOString() : '',
          driverName: r.driver_name || '',
          vehicleInfo: r.vehicle_info || '',
          flightNumber: r.flight_number || '',
        }
      })
      ok(res, transformed)
      return
    }

    if (table === 'venues') {
      const transformed = result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        'Venue Name': r.name,
        type: r.type,
        capacity: r.capacity,
        floor: r.floor || '',
        building: r.building || '',
        equipment: r.equipment || [],
      }))
      ok(res, transformed)
      return
    }

    if (table === 'pairings') {
      // Join with staff and guest names
      const joinedResult = await pool.query(`
        SELECT p.id, p.guest_id, p.staff_id, p.role, p.properties,
               g.name AS guest_name, s.name AS staff_name, s.email AS staff_email
        FROM pairings p
        LEFT JOIN guests g ON g.id = p.guest_id
        LEFT JOIN staff s ON s.id = p.staff_id
        ORDER BY g.name, p.role
      `)
      const transformed = joinedResult.rows.map((r) => ({
        id: r.id,
        pairingId: r.id,
        guestId: r.guest_id,
        guestName: r.guest_name || '',
        staffId: r.staff_id,
        staffName: r.staff_name || '',
        staffEmail: r.staff_email || '',
        role: r.role,
      }))
      ok(res, transformed)
      return
    }

    ok(res, result.rows)
  } catch (e) {
    err(res, 500, `Failed to query ${concept}: ${(e as Error).message}`)
  }
}

async function handleDomainDetail(res: VercelResponse, concept: string, id: string): Promise<void> {
  if (VIRTUAL_DOMAINS.has(concept)) {
    err(res, 404, `No records for virtual domain: ${concept}`)
    return
  }

  const table = TABLE_MAP[concept]
  if (!table || !SAFE_TABLES.has(table)) {
    err(res, 404, `Unknown concept: ${concept}`)
    return
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
    if (result.rows.length === 0) {
      err(res, 404, 'Record not found')
    } else {
      ok(res, result.rows[0])
    }
  } catch (e) {
    err(res, 500, `Failed to query ${table}: ${(e as Error).message}`)
  }
}

/* ==================================================================== */
/*  Config tables: form, view, workflow                                  */
/* ==================================================================== */

async function handleFormConfigs(res: VercelResponse): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, concept_key, name, layout, fields, steps, version, status
       FROM form_configs WHERE status = 'active' ORDER BY concept_key, name`
    )
    ok(res, result.rows)
  } catch {
    ok(res, [])
  }
}

async function handleViewConfigs(res: VercelResponse): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, concept_key, name, view_type, columns, filters, sort, group_by, version, status
       FROM view_configs WHERE status = 'active' ORDER BY concept_key, name`
    )
    ok(res, result.rows)
  } catch {
    ok(res, [])
  }
}

async function handleWorkflowConfigs(res: VercelResponse): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT id, name, description, trigger, condition, actions, enabled, version, status
       FROM workflow_configs WHERE status = 'active' ORDER BY name`
    )
    ok(res, result.rows)
  } catch {
    ok(res, [])
  }
}

/* ==================================================================== */
/*  Action router                                                        */
/* ==================================================================== */

async function handleAction(
  res: VercelResponse,
  action: string,
  params: Record<string, unknown>,
): Promise<void> {
  switch (action) {
    case 'getUserRole':
      ok(res, { role: 'director' })
      break

    case 'getDashboardData':
      await handleDashboard(res)
      break

    case 'getGuestList':
      await handleGetGuestList(res)
      break

    case 'getStaffList':
      await handleGetStaffList(res)
      break

    case 'getScheduleList':
      await handleGetScheduleList(res)
      break

    case 'getPrepItems':
      await handleGetPrepItems(res)
      break

    case 'getGuestDetail': {
      const guestId = params?.guestId as string
      if (!guestId) {
        err(res, 400, 'guestId required')
        return
      }
      await handleGetGuestDetail(res, guestId)
      break
    }

    default:
      // Unhandled actions return empty success (writes handled client-side in demo mode)
      ok(res, {})
  }
}

/* ==================================================================== */
/*  Main handler                                                         */
/* ==================================================================== */

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dev-Email, X-Dev-Role')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const path = req.url?.replace(/\?.*$/, '') ?? '/'

  try {
    // Health check
    if (path === '/api/health') {
      ok(res, { status: 'ok', timestamp: new Date().toISOString() })
      return
    }

    // Config
    if (path === '/api/config') {
      if (req.method === 'POST') {
        // Config save — demo mode just echoes back
        ok(res, req.body)
        return
      }
      await handleConfig(res)
      return
    }

    // Ontology
    if (path === '/api/ontology') {
      await handleOntology(res)
      return
    }

    // Visualization graph
    if (path === '/api/visualization/graph') {
      await handleVisualizationGraph(res)
      return
    }

    // Action endpoint (legacy call() interface)
    if (path === '/api/action' && req.method === 'POST') {
      const body = (req.body as Record<string, unknown>) ?? {}
      await handleAction(
        res,
        body.action as string,
        (body.params as Record<string, unknown>) ?? {},
      )
      return
    }

    // Form configs
    if (path === '/api/form-configs' || path.startsWith('/api/form-configs/')) {
      await handleFormConfigs(res)
      return
    }

    // View configs
    if (path === '/api/view-configs' || path.startsWith('/api/view-configs/')) {
      await handleViewConfigs(res)
      return
    }

    // Workflow configs
    if (path === '/api/workflow-configs' || path.startsWith('/api/workflow-configs/')) {
      await handleWorkflowConfigs(res)
      return
    }

    // Domain CRUD
    const domainMatch = path.match(/^\/api\/domains\/([^/]+)(?:\/([^/]+))?$/)
    if (domainMatch) {
      const [, concept, id] = domainMatch
      if (id) {
        await handleDomainDetail(res, concept, id)
      } else {
        await handleDomainList(res, concept)
      }
      return
    }

    // Data routes (legacy)
    if (path.startsWith('/api/data-routes')) {
      ok(res, [])
      return
    }

    err(res, 404, `Not found: ${path}`)
  } catch (e) {
    err(res, 500, `Internal error: ${(e as Error).message}`)
  }
}
