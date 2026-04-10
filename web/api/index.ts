/**
 * Vercel Functions — Lightweight read-only API for demo deployment
 *
 * Connects to Neon Postgres and serves read requests.
 * Writes are handled client-side in localStorage (demo mode).
 * For production, deploy the full Express app from functions/.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

/* ---- Concept-to-table mapping ---- */

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
  contract: 'contracts',
  contracts: 'contracts',
}

const SAFE_TABLES = new Set(Object.values(TABLE_MAP))

/* ---- Helpers ---- */

function ok(res: VercelResponse, data: unknown): void {
  res.status(200).json({ success: true, data })
}

function err(res: VercelResponse, status: number, message: string): void {
  res.status(status).json({ success: false, error: message })
}

/* ---- Route handlers ---- */

async function handleConfig(res: VercelResponse): Promise<void> {
  // Return convention config from conventions table or fallback
  try {
    const result = await pool.query(
      `SELECT config FROM convention_config LIMIT 1`
    )
    if (result.rows.length > 0) {
      ok(res, result.rows[0].config)
    } else {
      ok(res, {
        convention: { name: 'Convention', logoUrl: '/placeholder-logo.svg' },
        departments: [],
        roles: [],
        eventTypes: [],
        venues: [],
        prepTemplates: [],
        constraints: [],
      })
    }
  } catch {
    // Table might not exist or be empty — return defaults
    ok(res, {
      convention: { name: 'Convention', logoUrl: '/placeholder-logo.svg' },
      departments: [],
      roles: [],
      eventTypes: [],
      venues: [],
      prepTemplates: [],
      constraints: [],
    })
  }
}

async function handleOntology(res: VercelResponse): Promise<void> {
  try {
    const concepts = await pool.query(
      `SELECT key, name AS label, plural_name AS "pluralLabel", icon, description
       FROM ontology_concepts WHERE status = 'active' ORDER BY key`
    )

    const properties = await pool.query(
      `SELECT concept_key, key, label, type, required, sort_order, options, placeholder
       FROM ontology_properties WHERE status = 'active' ORDER BY concept_key, sort_order`
    )

    const relationships = await pool.query(
      `SELECT source_concept, target_concept, relationship_type, label, cardinality
       FROM ontology_relationships WHERE status = 'active'`
    )

    // Group properties and relationships by concept
    const propMap = new Map<string, unknown[]>()
    for (const p of properties.rows) {
      const arr = propMap.get(p.concept_key) ?? []
      arr.push(p)
      propMap.set(p.concept_key, arr)
    }

    const relMap = new Map<string, unknown[]>()
    for (const r of relationships.rows) {
      const arr = relMap.get(r.source_concept) ?? []
      arr.push(r)
      relMap.set(r.source_concept, arr)
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

async function handleDomainList(res: VercelResponse, concept: string): Promise<void> {
  const table = TABLE_MAP[concept]
  if (!table || !SAFE_TABLES.has(table)) {
    err(res, 404, `Unknown concept: ${concept}`)
    return
  }

  try {
    const result = await pool.query(
      `SELECT * FROM ${table} WHERE archived IS NOT TRUE ORDER BY created_at DESC LIMIT 500`
    )
    ok(res, result.rows)
  } catch (e) {
    // Table might not have archived column
    try {
      const result = await pool.query(`SELECT * FROM ${table} LIMIT 500`)
      ok(res, result.rows)
    } catch (e2) {
      err(res, 500, `Failed to query ${table}: ${(e2 as Error).message}`)
    }
  }
}

async function handleDomainDetail(res: VercelResponse, concept: string, id: string): Promise<void> {
  const table = TABLE_MAP[concept]
  if (!table || !SAFE_TABLES.has(table)) {
    err(res, 404, `Unknown concept: ${concept}`)
    return
  }

  try {
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
    if (result.rows.length === 0) {
      err(res, 404, `Record not found`)
    } else {
      ok(res, result.rows[0])
    }
  } catch (e) {
    err(res, 500, `Failed to query ${table}: ${(e as Error).message}`)
  }
}

async function handleAction(res: VercelResponse, action: string, params: Record<string, unknown>): Promise<void> {
  switch (action) {
    case 'getUserRole':
      ok(res, { role: 'director' })
      break

    case 'getDashboardData':
      await handleDashboard(res)
      break

    case 'getGuestList':
      await handleDomainList(res, 'guest')
      break

    case 'getStaffList':
      await handleDomainList(res, 'staff')
      break

    case 'getScheduleList':
      await handleDomainList(res, 'schedule')
      break

    case 'getPrepItems':
      await handleDomainList(res, 'prep')
      break

    case 'getGuestDetail': {
      const guestId = params?.guestId as string
      if (!guestId) { err(res, 400, 'guestId required'); return }

      const guest = await pool.query('SELECT * FROM guests WHERE id = $1', [guestId])
      if (guest.rows.length === 0) { err(res, 404, 'Guest not found'); return }

      const schedule = await pool.query('SELECT * FROM schedule_events WHERE guest_id = $1', [guestId])
      const travel = await pool.query('SELECT * FROM transport_bookings WHERE guest_id = $1', [guestId])
      const prep = await pool.query('SELECT * FROM prep_items WHERE guest_id = $1', [guestId])
      const pairings = await pool.query('SELECT * FROM pairings WHERE guest_id = $1', [guestId])

      ok(res, {
        guest: guest.rows[0],
        schedule: schedule.rows,
        travel: travel.rows,
        accommodations: [],
        dietary: [],
        autographs: [],
        prepTracker: prep.rows,
        pairings: pairings.rows,
        violations: [],
      })
      break
    }

    default:
      // Unhandled actions return empty success (writes handled client-side)
      ok(res, {})
  }
}

async function handleDashboard(res: VercelResponse): Promise<void> {
  try {
    const guests = await pool.query('SELECT * FROM guests WHERE archived IS NOT TRUE')
    const prep = await pool.query('SELECT * FROM prep_items')
    const schedule = await pool.query('SELECT * FROM schedule_events')
    const staff = await pool.query('SELECT * FROM staff WHERE archived IS NOT TRUE')
    const pairings = await pool.query('SELECT * FROM pairings')

    const guestRows = guests.rows
    const prepRows = prep.rows
    const completed = prepRows.filter((p: Record<string, unknown>) => p.status === 'complete').length
    const pct = prepRows.length > 0 ? Math.round((completed / prepRows.length) * 100) : 0

    const byStatus: Record<string, number> = {}
    for (const g of guestRows) {
      const s = String(g.status ?? 'unknown')
      const label = s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
      byStatus[label] = (byStatus[label] ?? 0) + 1
    }

    const liaisonGuests = new Set(
      pairings.rows
        .filter((p: Record<string, unknown>) => p.role === 'Main Liaison' && p.status === 'active')
        .map((p: Record<string, unknown>) => p.guest_id)
    )

    ok(res, {
      guests: {
        total: guestRows.length,
        confirmed: guestRows.filter((g: Record<string, unknown>) => ['confirmed', 'arrived', 'attending'].includes(String(g.status))).length,
        byStatus,
        byDepartment: groupBy(guestRows, 'department'),
      },
      schedule: {
        total: schedule.rows.length,
        confirmed: schedule.rows.filter((e: Record<string, unknown>) => e.status === 'confirmed').length,
        todayEvents: schedule.rows.slice(0, 10),
      },
      prep: {
        total: prepRows.length,
        completed,
        percentComplete: pct,
        percent: pct,
        overdue: prepRows.filter((p: Record<string, unknown>) => p.status === 'not_started').length,
        inProgress: prepRows.filter((p: Record<string, unknown>) => p.status === 'in_progress').length,
      },
      staffing: {
        total: staff.rows.length,
        guestsWithLiaison: liaisonGuests.size,
        coverage: guestRows.map((g: Record<string, unknown>) => ({
          guestId: g.id,
          guestName: g.name,
          hasLiaison: liaisonGuests.has(g.id),
          interpreterRequired: Boolean(g.interpreter_required),
          hasInterpreter: pairings.rows.some(
            (p: Record<string, unknown>) => p.guest_id === g.id && p.role === 'Interpreter'
          ),
        })),
      },
      violations: { total: 0, items: [], byStatus: { Active: 0 } },
      pendingChanges: { total: 0, items: [] },
    })
  } catch (e) {
    err(res, 500, `Dashboard failed: ${(e as Error).message}`)
  }
}

function groupBy(rows: Record<string, unknown>[], key: string): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) {
    const val = String(row[key] ?? 'Unknown')
    result[val] = (result[val] ?? 0) + 1
  }
  return result
}

/* ---- Main handler ---- */

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const path = req.url?.replace(/\?.*$/, '') ?? '/'

  // Health check
  if (path === '/api/health') {
    ok(res, { status: 'ok', timestamp: new Date().toISOString() })
    return
  }

  // Config
  if (path === '/api/config') {
    await handleConfig(res)
    return
  }

  // Ontology
  if (path === '/api/ontology') {
    await handleOntology(res)
    return
  }

  // Action endpoint (legacy call() interface)
  if (path === '/api/action' && req.method === 'POST') {
    const body = req.body as Record<string, unknown> ?? {}
    await handleAction(res, body.action as string, body.params as Record<string, unknown> ?? {})
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

  // Visualization graph
  if (path === '/api/visualization/graph') {
    await handleOntology(res) // Return ontology as graph basis
    return
  }

  // Workflow configs
  if (path.startsWith('/api/workflow-configs')) {
    try {
      const result = await pool.query('SELECT * FROM workflow_configs WHERE status = $1', ['active'])
      ok(res, result.rows)
    } catch {
      ok(res, [])
    }
    return
  }

  // Data routes
  if (path.startsWith('/api/data-routes')) {
    try {
      const result = await pool.query('SELECT * FROM data_routes WHERE enabled = true')
      ok(res, result.rows)
    } catch {
      ok(res, [])
    }
    return
  }

  // Form/view configs
  if (path.startsWith('/api/form-configs') || path.startsWith('/api/view-configs')) {
    ok(res, {})
    return
  }

  err(res, 404, `Not found: ${path}`)
}
