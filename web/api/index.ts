/**
 * Vercel Serverless Function — Read-Only API Adapter
 *
 * Thin bridge between the Vue frontend and Neon Postgres.
 * Serves the ontology config endpoints the frontend composables need.
 * No auth (public read-only for deployment verification).
 *
 * This is NOT the production backend — that's the Express app in functions/.
 * This exists solely so the frontend can be verified on Vercel.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

function ok(res: VercelResponse, data: unknown): void {
  res.status(200).json({ success: true, data })
}

function notFound(res: VercelResponse, msg: string): void {
  res.status(404).json({ success: false, error: msg })
}

function error(res: VercelResponse, msg: string): void {
  res.status(500).json({ success: false, error: msg })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  const path = (req.url ?? '').split('?')[0]

  try {
    // --- /api/health ---
    if (path === '/api/health') {
      ok(res, { status: 'ok', timestamp: new Date().toISOString() })
      return
    }

    // --- /api/ontology --- full ontology
    if (path === '/api/ontology') {
      const [concepts, properties, relationships] = await Promise.all([
        pool.query("SELECT * FROM ontology_concepts WHERE status = 'active' ORDER BY key"),
        pool.query("SELECT * FROM ontology_properties WHERE status = 'active' ORDER BY concept_key, sort_order"),
        pool.query("SELECT * FROM ontology_relationships WHERE status = 'active'"),
      ])

      // Group properties by concept
      const propsByConcept: Record<string, unknown[]> = {}
      for (const row of properties.rows) {
        const ck = row.concept_key
        if (!propsByConcept[ck]) propsByConcept[ck] = []
        propsByConcept[ck].push({
          key: row.key, label: row.label, type: row.type,
          required: row.required, options: row.options,
          placeholder: row.placeholder, hidden: row.hidden,
          readOnly: row.read_only, description: row.description,
        })
      }

      // Build concept array with embedded properties
      const conceptList = concepts.rows.map(c => ({
        key: c.key, label: c.name, pluralLabel: c.plural_name ?? `${c.name}s`,
        icon: c.icon ?? 'pi pi-box',
        properties: propsByConcept[c.key] ?? [],
        relationships: relationships.rows
          .filter(r => r.source_concept_key === c.key)
          .map(r => ({ key: r.key, label: r.label, target: r.target_concept_key, cardinality: r.cardinality })),
      }))

      ok(res, { concepts: conceptList, version: new Date().toISOString() })
      return
    }

    // --- /api/ontology/configs/views/:concept/:name ---
    const viewMatch = path.match(/^\/api\/ontology\/configs\/views\/([^/]+)\/([^/]+)$/)
    if (viewMatch) {
      const [, concept, name] = viewMatch
      const result = await pool.query(
        "SELECT * FROM view_configs WHERE concept_key = $1 AND name = $2 AND status = 'active' LIMIT 1",
        [concept, name]
      )
      if (result.rows.length === 0) { notFound(res, `No view config "${name}" for "${concept}"`); return }
      const row = result.rows[0]
      ok(res, {
        id: row.id, conceptKey: row.concept_key, name: row.name,
        viewType: row.view_type, columns: row.columns, filters: row.filters,
        sort: row.sort, groupBy: row.group_by, timelineStart: row.timeline_start,
        timelineEnd: row.timeline_end, rowAction: row.row_action, presets: row.presets,
        tabs: row.tabs,
      })
      return
    }

    // --- /api/ontology/configs/views/:concept ---
    const viewsMatch = path.match(/^\/api\/ontology\/configs\/views\/([^/]+)$/)
    if (viewsMatch) {
      const [, concept] = viewsMatch
      const result = await pool.query(
        "SELECT * FROM view_configs WHERE concept_key = $1 AND status = 'active'",
        [concept]
      )
      ok(res, result.rows.map(row => ({
        id: row.id, conceptKey: row.concept_key, name: row.name,
        viewType: row.view_type, columns: row.columns, filters: row.filters,
        sort: row.sort, groupBy: row.group_by, rowAction: row.row_action,
      })))
      return
    }

    // --- /api/ontology/configs/forms/:concept/:name ---
    const formMatch = path.match(/^\/api\/ontology\/configs\/forms\/([^/]+)\/([^/]+)$/)
    if (formMatch) {
      const [, concept, name] = formMatch
      const result = await pool.query(
        "SELECT * FROM form_configs WHERE concept_key = $1 AND name = $2 AND status = 'active' LIMIT 1",
        [concept, name]
      )
      if (result.rows.length === 0) { notFound(res, `No form config "${name}" for "${concept}"`); return }
      const row = result.rows[0]
      ok(res, {
        id: row.id, conceptKey: row.concept_key, name: row.name,
        layout: row.layout, fields: row.fields, steps: row.steps,
      })
      return
    }

    // --- /api/ontology/configs/forms/:concept ---
    const formsMatch = path.match(/^\/api\/ontology\/configs\/forms\/([^/]+)$/)
    if (formsMatch) {
      const [, concept] = formsMatch
      const result = await pool.query(
        "SELECT * FROM form_configs WHERE concept_key = $1 AND status = 'active' LIMIT 1",
        [concept]
      )
      if (result.rows.length === 0) { notFound(res, `No form config for "${concept}"`); return }
      const row = result.rows[0]
      ok(res, {
        id: row.id, conceptKey: row.concept_key, name: row.name,
        layout: row.layout, fields: row.fields, steps: row.steps,
      })
      return
    }

    // --- /api/ontology/configs/pages/:slug ---
    const pageMatch = path.match(/^\/api\/ontology\/configs\/pages\/([^/]+)$/)
    if (pageMatch) {
      const [, slug] = pageMatch
      const result = await pool.query(
        "SELECT * FROM page_configs WHERE slug = $1 AND status = 'active' LIMIT 1",
        [slug]
      )
      if (result.rows.length === 0) { notFound(res, `No page config for slug "${slug}"`); return }
      const row = result.rows[0]
      ok(res, {
        id: row.id, name: row.name, slug: row.slug,
        widgets: row.widgets, breakpoints: row.breakpoints,
      })
      return
    }

    // --- /api/config --- global platform config
    if (path === '/api/config') {
      try {
        const result = await pool.query(
          "SELECT * FROM platform_config WHERE key = 'theme' LIMIT 1"
        )
        ok(res, result.rows[0] ?? { key: 'theme', value: {} })
      } catch {
        ok(res, { key: 'theme', value: {} })
      }
      return
    }

    // --- /api/form-configs --- list form configs (for builders)
    const formConfigsMatch = path.match(/^\/api\/form-configs/)
    if (formConfigsMatch) {
      const conceptKey = new URL(req.url ?? '', 'http://localhost').searchParams.get('conceptKey')
      const where = conceptKey ? "WHERE concept_key = $1 AND status = 'active'" : "WHERE status = 'active'"
      const params = conceptKey ? [conceptKey] : []
      const result = await pool.query(`SELECT * FROM form_configs ${where} ORDER BY concept_key, name`, params)
      ok(res, result.rows)
      return
    }

    // --- /api/view-configs --- list view configs (for builders)
    const viewConfigsMatch = path.match(/^\/api\/view-configs/)
    if (viewConfigsMatch) {
      const conceptKey = new URL(req.url ?? '', 'http://localhost').searchParams.get('conceptKey')
      const where = conceptKey ? "WHERE concept_key = $1 AND status = 'active'" : "WHERE status = 'active'"
      const params = conceptKey ? [conceptKey] : []
      const result = await pool.query(`SELECT * FROM view_configs ${where} ORDER BY concept_key, name`, params)
      ok(res, result.rows)
      return
    }

    // --- /api/visualization/graph and /api/ontology/visualization/graph --- system graph for canvas
    if (path === '/api/visualization/graph' || path === '/api/ontology/visualization/graph') {
      const [concepts, relationships, properties] = await Promise.all([
        pool.query("SELECT * FROM ontology_concepts WHERE status = 'active'"),
        pool.query("SELECT * FROM ontology_relationships WHERE status = 'active'"),
        pool.query("SELECT concept_key, count(*) as prop_count FROM ontology_properties WHERE status = 'active' GROUP BY concept_key"),
      ])
      const propCounts: Record<string, number> = {}
      for (const r of properties.rows) propCounts[r.concept_key] = parseInt(r.prop_count)

      const nodes = concepts.rows.map((c: any) => ({
        id: c.key, type: 'concept', label: c.name,
        data: { key: c.key, name: c.name, pluralName: c.plural_name, icon: c.icon, propertyCount: propCounts[c.key] ?? 0, isConfig: c.is_config, isRegistry: c.is_registry },
      }))
      const edges = relationships.rows.map((r: any) => ({
        id: `${r.source_concept_key}-${r.key}-${r.target_concept_key}`,
        source: r.source_concept_key, target: r.target_concept_key,
        type: 'relationship', label: r.label,
        data: { key: r.key, cardinality: r.cardinality },
      }))
      ok(res, { nodes, edges })
      return
    }

    // --- /api/data-routes --- data flow canvas
    if (path.startsWith('/api/data-routes')) {
      try {
        const result = await pool.query("SELECT * FROM data_routes WHERE enabled = true")
        ok(res, result.rows)
      } catch {
        ok(res, []) // Table may not exist yet
      }
      return
    }

    // --- /api/stream --- SSE stub (canvas real-time)
    if (path === '/api/stream') {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.write('data: {"type":"connected"}\n\n')
      // Keep connection open briefly then close (stub for read-only deployment)
      setTimeout(() => res.end(), 5000)
      return
    }

    // --- /api/domains/:concept/:id ---
    const domainDetailMatch = path.match(/^\/api\/domains\/([^/]+)\/([^/]+)$/)
    if (domainDetailMatch) {
      const [, concept, id] = domainDetailMatch
      const table = conceptToTable(concept)
      const noArchived = ['workflow_configs', 'guest_form_sessions'].includes(table)
      const whereClause = noArchived ? 'WHERE id = $1' : 'WHERE id = $1 AND NOT archived'
      const result = await pool.query(`SELECT * FROM ${table} ${whereClause}`, [id])
      if (result.rows.length === 0) { notFound(res, `Record not found`); return }
      ok(res, result.rows[0])
      return
    }

    // --- /api/domains/:concept ---
    const domainMatch = path.match(/^\/api\/domains\/([^/]+)$/)
    if (domainMatch) {
      const [, concept] = domainMatch
      const table = conceptToTable(concept)
      const noArchived = ['workflow_configs', 'guest_form_sessions'].includes(table)
      const whereClause = noArchived ? '' : 'WHERE NOT archived'
      try {
        const result = await pool.query(
          `SELECT * FROM ${table} ${whereClause} ORDER BY created_at DESC LIMIT 100`
        )
        ok(res, { records: result.rows, total: result.rowCount })
      } catch (tableErr) {
        // Table might not exist yet — return empty result instead of 500
        const msg = tableErr instanceof Error ? tableErr.message : ''
        if (msg.includes('does not exist')) {
          ok(res, { records: [], total: 0 })
        } else {
          throw tableErr
        }
      }
      return
    }

    notFound(res, 'Endpoint not found')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('API error:', msg)
    error(res, msg)
  }
}

/** Map concept keys AND route slugs to Postgres table names */
function conceptToTable(concept: string): string {
  const map: Record<string, string> = {
    // Concept keys (singular, from config-driven routes)
    guest: 'guests', staff: 'staff', schedule_event: 'schedule_events',
    prep_item: 'prep_items', pairing: 'pairings', venue: 'venues',
    transport_booking: 'transport_bookings', generated_contract: 'generated_contracts',
    workflow_config: 'workflow_configs', transport_driver: 'transport_drivers',
    guest_form_session: 'guest_form_sessions',
    // Route slugs (already plural, from DomainListView routes)
    pairings: 'pairings', venues: 'venues', accommodations: 'accommodations',
    autographs: 'autographs', dietary: 'dietary', travel: 'transport_bookings',
  }
  return map[concept] ?? concept
}
