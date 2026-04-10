/**
 * Demo Store — localStorage-backed reactive state with CRUD
 *
 * The ONLY demo infrastructure file. Replaces demo-client.ts, demo-state.ts,
 * and DemoBar.vue with a single mutable data store that the API client routes
 * to in DEMO_MODE.
 */

import { ref } from 'vue'

/* ---- Deep clone (JSON round-trip, safe for frozen Vite JSON imports) ---- */

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/* ---- Seed data imports ---- */
import seedGuests from './data/guests.json'
import seedStaff from './data/staff.json'
import seedSchedule from './data/schedule.json'
import seedVenues from './data/venues.json'
import seedPairings from './data/pairings.json'
import seedPrepItems from './data/prep-items.json'
import seedTransport from './data/transport.json'
import seedContracts from './data/contracts.json'
import seedOntology from './data/ontology.json'
import seedConfig from './data/config.json'

/* ---- Constants ---- */

const STORAGE_KEY = 'gr-ops-demo-state'
const SEED_VERSION = 1
const SIZE_WARNING_KB = 4096

/* ---- ID field mapping per entity type ---- */

const ID_FIELDS: Readonly<Record<string, string>> = {
  guests: 'guestId',
  staff: 'staffId',
  schedule: 'eventId',
  venues: 'venueId',
  pairings: 'pairingId',
  prepItems: 'id',
  transport: 'transportId',
  contracts: 'contractId',
}

const ID_PREFIXES: Readonly<Record<string, string>> = {
  guests: 'g-demo-',
  staff: 's-demo-',
  schedule: 'e-demo-',
  venues: 'v-demo-',
  pairings: 'p-demo-',
  prepItems: 'pi-demo-',
  transport: 't-demo-',
  contracts: 'c-demo-',
}

/* ---- Types ---- */

interface DemoState {
  readonly version: number
  readonly guests: ReadonlyArray<Record<string, unknown>>
  readonly staff: ReadonlyArray<Record<string, unknown>>
  readonly schedule: ReadonlyArray<Record<string, unknown>>
  readonly venues: ReadonlyArray<Record<string, unknown>>
  readonly pairings: ReadonlyArray<Record<string, unknown>>
  readonly prepItems: ReadonlyArray<Record<string, unknown>>
  readonly transport: ReadonlyArray<Record<string, unknown>>
  readonly contracts: ReadonlyArray<Record<string, unknown>>
  readonly ontology: Record<string, unknown>
  readonly config: Record<string, unknown>
}

type CollectionKey = 'guests' | 'staff' | 'schedule' | 'venues' | 'pairings' | 'prepItems' | 'transport' | 'contracts'

/* ---- ID generation ---- */

function generateId(collection: CollectionKey): string {
  const prefix = ID_PREFIXES[collection]
  const bytes = new Uint8Array(3)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${prefix}${hex}`
}

/* ---- Seed data builder ---- */

function buildSeedState(): DemoState {
  return {
    version: SEED_VERSION,
    guests: deepClone(seedGuests) as Record<string, unknown>[],
    staff: deepClone(seedStaff) as Record<string, unknown>[],
    schedule: deepClone(seedSchedule) as Record<string, unknown>[],
    venues: deepClone(seedVenues) as Record<string, unknown>[],
    pairings: deepClone(seedPairings) as Record<string, unknown>[],
    prepItems: deepClone(seedPrepItems) as Record<string, unknown>[],
    transport: deepClone(seedTransport) as Record<string, unknown>[],
    contracts: deepClone(seedContracts) as Record<string, unknown>[],
    ontology: deepClone(seedOntology) as Record<string, unknown>,
    config: deepClone(seedConfig) as Record<string, unknown>,
  }
}

/* ---- Persistence ---- */

let persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
  }
  persistTimer = setTimeout(() => {
    try {
      const serialized = JSON.stringify(state.value)
      localStorage.setItem(STORAGE_KEY, serialized)
      checkSizeBudget(serialized)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.warn('Demo state exceeds localStorage quota. Consider exporting and resetting.')
      }
    }
    persistTimer = null
  }, 100)
}

function checkSizeBudget(serialized: string): void {
  const sizeKB = new Blob([serialized]).size / 1024
  if (sizeKB > SIZE_WARNING_KB) {
    console.warn(
      `Demo state is ${(sizeKB / 1024).toFixed(1)}MB. Consider exporting and resetting.`,
    )
  }
}

/* ---- Initialization ---- */

function loadOrInitialize(): DemoState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as DemoState
      if (parsed.version === SEED_VERSION) {
        return parsed
      }
      // Version mismatch — reset to seed data
      console.info('Demo seed version changed. Resetting to new defaults.')
      localStorage.removeItem(STORAGE_KEY)
      return buildSeedState()
    }
  } catch {
    // Corrupt localStorage — clear and reinitialize
    console.warn('Corrupt demo state in localStorage. Reinitializing from seed data.')
    localStorage.removeItem(STORAGE_KEY)
  }
  return buildSeedState()
}

/* ---- Reactive state ---- */

const state = ref<DemoState>(loadOrInitialize())

/* ---- Getters (immutable clones) ---- */

function getCollection(key: CollectionKey): Record<string, unknown>[] {
  return deepClone(state.value[key]) as Record<string, unknown>[]
}

function getRecord(collection: CollectionKey, id: string): Record<string, unknown> | null {
  const idField = ID_FIELDS[collection]
  const record = (state.value[collection] as ReadonlyArray<Record<string, unknown>>)
    .find((r) => r[idField] === id)
  return record ? deepClone(record) as Record<string, unknown> : null
}

function getSingleton(key: 'ontology' | 'config'): Record<string, unknown> {
  return deepClone(state.value[key]) as Record<string, unknown>
}

/* ---- Mutations ---- */

function createRecord(
  collection: CollectionKey,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const idField = ID_FIELDS[collection]
  const newId = generateId(collection)
  const record = { ...data, [idField]: newId }

  state.value = {
    ...state.value,
    [collection]: [...state.value[collection], record],
  }

  schedulePersist()
  return deepClone(record) as Record<string, unknown>
}

function updateRecord(
  collection: CollectionKey,
  id: string,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const idField = ID_FIELDS[collection]
  const items = state.value[collection] as ReadonlyArray<Record<string, unknown>>
  const idx = items.findIndex((r) => r[idField] === id)
  if (idx === -1) {
    throw new Error(`Record ${id} not found in ${collection}`)
  }

  const updated = { ...items[idx], ...updates, rowVersion: (Number(items[idx].rowVersion ?? 0) + 1) }
  state.value = {
    ...state.value,
    [collection]: [
      ...items.slice(0, idx),
      updated,
      ...items.slice(idx + 1),
    ],
  }

  schedulePersist()
  return deepClone(updated) as Record<string, unknown>
}

function deleteRecord(collection: CollectionKey, id: string): void {
  const idField = ID_FIELDS[collection]
  const items = state.value[collection] as ReadonlyArray<Record<string, unknown>>
  const filtered = items.filter((r) => r[idField] !== id)

  if (filtered.length === items.length) {
    throw new Error(`Record ${id} not found in ${collection}`)
  }

  state.value = {
    ...state.value,
    [collection]: filtered,
  }

  schedulePersist()
}

function updateSingleton(
  key: 'ontology' | 'config',
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const updated = { ...state.value[key], ...updates }
  state.value = {
    ...state.value,
    [key]: updated,
  }
  schedulePersist()
  return deepClone(updated) as Record<string, unknown>
}

/* ---- Reset / Import / Export ---- */

function resetState(): void {
  localStorage.removeItem(STORAGE_KEY)
  state.value = buildSeedState()
}

function exportState(): string {
  return JSON.stringify(state.value, null, 2)
}

function importState(json: string): { success: boolean; error?: string } {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>

    // Validate required keys
    const requiredKeys: string[] = [
      'guests', 'staff', 'schedule', 'venues', 'pairings',
      'prepItems', 'transport', 'contracts', 'ontology', 'config',
    ]
    const missing = requiredKeys.filter((k) => !(k in parsed))
    if (missing.length > 0) {
      return { success: false, error: `Missing collections: ${missing.join(', ')}` }
    }

    // Validate arrays
    for (const key of requiredKeys.slice(0, 8)) {
      if (!Array.isArray(parsed[key])) {
        return { success: false, error: `${key} must be an array` }
      }
    }

    state.value = { ...parsed, version: SEED_VERSION } as DemoState
    schedulePersist()
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Invalid JSON' }
  }
}

/* ---- Dashboard aggregation ---- */

function getDashboardData(): Record<string, unknown> {
  const guests = state.value.guests as ReadonlyArray<Record<string, unknown>>
  const preps = state.value.prepItems as ReadonlyArray<Record<string, unknown>>
  const schedule = state.value.schedule as ReadonlyArray<Record<string, unknown>>
  const pairings = state.value.pairings as ReadonlyArray<Record<string, unknown>>
  const transport = state.value.transport as ReadonlyArray<Record<string, unknown>>

  const completedPrep = preps.filter((p) => p.status === 'complete').length
  const overduePrep = preps.filter((p) => p.status === 'not_started').length
  const prepPercent = preps.length > 0 ? Math.round((completedPrep / preps.length) * 100) : 0

  // Liaison coverage
  const guestsWithLiaison = new Set(
    (pairings as ReadonlyArray<Record<string, unknown>>)
      .filter((p) => p.role === 'Main Liaison' && p.status === 'active')
      .map((p) => p.guestId),
  )

  const coverage = guests.map((g) => {
    const guestPairings = (pairings as ReadonlyArray<Record<string, unknown>>)
      .filter((p) => p.guestId === g.guestId)
    return {
      guestId: g.guestId,
      guestName: g.name,
      hasLiaison: guestPairings.some((p) => p.role === 'Main Liaison'),
      interpreterRequired: Boolean(g.interpreterRequired),
      hasInterpreter: guestPairings.some((p) => p.role === 'Interpreter'),
    }
  })

  // Guests missing transport
  const guestsWithTransport = new Set(transport.map((t) => t.guestId))
  const confirmedStatuses = ['confirmed', 'travel_arranged', 'arrived', 'attending']
  const missingTravel = guests.filter(
    (g) => confirmedStatuses.includes(String(g.status)) && !guestsWithTransport.has(g.guestId),
  ).length

  // Status counts — capitalize for dashboard display
  const byStatus: Record<string, number> = {}
  for (const g of guests) {
    const status = String(g.status ?? 'unknown')
    const label = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ')
    byStatus[label] = (byStatus[label] ?? 0) + 1
  }

  // Today's events (use first convention day as default)
  const conventionDates = ['2026-04-03', '2026-04-04', '2026-04-05']
  const todayEvents = schedule.filter((e) => e.date === conventionDates[0])

  return {
    guests: {
      total: guests.length,
      confirmed: guests.filter((g) => confirmedStatuses.includes(String(g.status))).length,
      jp: guests.filter((g) => g.type === 'JP').length,
      na: guests.filter((g) => g.type === 'NA').length,
      missingTravel,
      byDepartment: groupBy(guests, 'department'),
      byStatus,
    },
    schedule: {
      total: schedule.length,
      confirmed: schedule.filter((e) => e.status === 'confirmed').length,
      daysUntilConvention: 0,
      todayEvents,
      byDay: Object.fromEntries(conventionDates.map((d) => [
        d,
        schedule.filter((e) => e.date === d).length,
      ])),
    },
    prep: {
      total: preps.length,
      completed: completedPrep,
      percentComplete: prepPercent,
      percent: prepPercent,
      overdue: overduePrep,
      inProgress: preps.filter((p) => p.status === 'in_progress').length,
      notStarted: overduePrep,
    },
    staffing: {
      total: (state.value.staff as ReadonlyArray<Record<string, unknown>>).length,
      guestsWithLiaison: guestsWithLiaison.size,
      coverage,
      byRole: groupBy(state.value.staff as ReadonlyArray<Record<string, unknown>>, 'role'),
      byDepartment: groupBy(state.value.staff as ReadonlyArray<Record<string, unknown>>, 'department'),
    },
    violations: {
      total: 0,
      items: [],
      byStatus: { Active: 0 },
    },
    pendingChanges: {
      total: 0,
      items: [],
    },
  }
}

function groupBy(
  items: ReadonlyArray<Record<string, unknown>>,
  key: string,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of items) {
    const value = String(item[key] ?? 'Unknown')
    result[value] = (result[value] ?? 0) + 1
  }
  return result
}

/* ---- Guest detail (enriched) ---- */

function getGuestDetail(guestId: string): Record<string, unknown> | null {
  const guest = getRecord('guests', guestId)
  if (!guest) return null

  return {
    guest,
    schedule: (state.value.schedule as ReadonlyArray<Record<string, unknown>>)
      .filter((e) => e.guestId === guestId)
      .map((e) => deepClone(e)),
    travel: (state.value.transport as ReadonlyArray<Record<string, unknown>>)
      .filter((t) => t.guestId === guestId)
      .map((t) => deepClone(t)),
    accommodations: [],
    dietary: [],
    autographs: [],
    prepTracker: (state.value.prepItems as ReadonlyArray<Record<string, unknown>>)
      .filter((p) => p.guestId === guestId)
      .map((p) => deepClone(p)),
    pairings: (state.value.pairings as ReadonlyArray<Record<string, unknown>>)
      .filter((p) => p.guestId === guestId)
      .map((p) => deepClone(p)),
    violations: [],
  }
}

/* ---- Visualization graph ---- */

function getVisualizationGraph(): Record<string, unknown> {
  const guests = state.value.guests as ReadonlyArray<Record<string, unknown>>
  const staff = state.value.staff as ReadonlyArray<Record<string, unknown>>
  const schedule = state.value.schedule as ReadonlyArray<Record<string, unknown>>
  const pairings = state.value.pairings as ReadonlyArray<Record<string, unknown>>

  const conceptNodes = [
    { id: 'concept-guest', type: 'concept', label: 'Guest', sourceId: 'guest', sourceTable: 'ontology_concepts', region: 'GR Core', properties: { icon: 'pi pi-user', propertyCount: guests.length } },
    { id: 'concept-staff', type: 'concept', label: 'Staff', sourceId: 'staff', sourceTable: 'ontology_concepts', region: 'GR Core', properties: { icon: 'pi pi-users', propertyCount: staff.length } },
    { id: 'concept-pairing', type: 'concept', label: 'Pairing', sourceId: 'pairing', sourceTable: 'ontology_concepts', region: 'GR Core', properties: { icon: 'pi pi-link', propertyCount: pairings.length } },
    { id: 'concept-event', type: 'concept', label: 'Schedule Event', sourceId: 'schedule_event', sourceTable: 'ontology_concepts', region: 'Operations', properties: { icon: 'pi pi-calendar', propertyCount: schedule.length } },
    { id: 'concept-venue', type: 'concept', label: 'Venue', sourceId: 'venue', sourceTable: 'ontology_concepts', region: 'Operations', properties: { icon: 'pi pi-building', propertyCount: (state.value.venues as ReadonlyArray<Record<string, unknown>>).length } },
    { id: 'concept-prep', type: 'concept', label: 'Prep Item', sourceId: 'prep_item', sourceTable: 'ontology_concepts', region: 'GR Core', properties: { icon: 'pi pi-check-square', propertyCount: (state.value.prepItems as ReadonlyArray<Record<string, unknown>>).length } },
    { id: 'concept-transport', type: 'concept', label: 'Transport', sourceId: 'transport', sourceTable: 'ontology_concepts', region: 'Logistics', properties: { icon: 'pi pi-car', propertyCount: (state.value.transport as ReadonlyArray<Record<string, unknown>>).length } },
    { id: 'concept-contract', type: 'concept', label: 'Contract', sourceId: 'contract', sourceTable: 'ontology_concepts', region: 'GR Core', properties: { icon: 'pi pi-file', propertyCount: (state.value.contracts as ReadonlyArray<Record<string, unknown>>).length } },
    { id: 'concept-convention', type: 'concept', label: 'Convention', sourceId: 'convention', sourceTable: 'ontology_concepts', region: 'Platform', properties: { icon: 'pi pi-globe', propertyCount: 1 } },
    { id: 'concept-registry', type: 'concept', label: 'Guest Registry', sourceId: 'guest_registry', sourceTable: 'ontology_concepts', region: 'Platform', properties: { icon: 'pi pi-database', propertyCount: 0 } },
  ]

  const relationshipEdges = [
    { id: 'rel-guest-pairing', type: 'relationship', sourceNodeId: 'concept-guest', targetNodeId: 'concept-pairing', label: 'assigned via', properties: { cardinality: '1:N' } },
    { id: 'rel-staff-pairing', type: 'relationship', sourceNodeId: 'concept-staff', targetNodeId: 'concept-pairing', label: 'assigned via', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-event', type: 'relationship', sourceNodeId: 'concept-guest', targetNodeId: 'concept-event', label: 'participates in', properties: { cardinality: '1:N' } },
    { id: 'rel-venue-event', type: 'relationship', sourceNodeId: 'concept-venue', targetNodeId: 'concept-event', label: 'hosts', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-prep', type: 'relationship', sourceNodeId: 'concept-guest', targetNodeId: 'concept-prep', label: 'tracked by', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-transport', type: 'relationship', sourceNodeId: 'concept-guest', targetNodeId: 'concept-transport', label: 'booked for', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-contract', type: 'relationship', sourceNodeId: 'concept-guest', targetNodeId: 'concept-contract', label: 'bound by', properties: { cardinality: '1:1' } },
    { id: 'rel-convention-guest', type: 'relationship', sourceNodeId: 'concept-convention', targetNodeId: 'concept-guest', label: 'invites', properties: { cardinality: '1:N' } },
    { id: 'rel-convention-venue', type: 'relationship', sourceNodeId: 'concept-convention', targetNodeId: 'concept-venue', label: 'uses', properties: { cardinality: '1:N' } },
    { id: 'rel-registry-guest', type: 'relationship', sourceNodeId: 'concept-registry', targetNodeId: 'concept-guest', label: 'pre-populates', properties: { cardinality: '1:N' } },
  ]

  return {
    nodes: conceptNodes,
    edges: relationshipEdges,
    regions: [
      { id: 'region-gr-core', label: 'GR Core', color: '#3b82f6', nodeIds: conceptNodes.filter((n) => n.region === 'GR Core').map((n) => n.id) },
      { id: 'region-operations', label: 'Operations', color: '#10b981', nodeIds: conceptNodes.filter((n) => n.region === 'Operations').map((n) => n.id) },
      { id: 'region-logistics', label: 'Logistics', color: '#f59e0b', nodeIds: conceptNodes.filter((n) => n.region === 'Logistics').map((n) => n.id) },
      { id: 'region-platform', label: 'Platform', color: '#8b5cf6', nodeIds: conceptNodes.filter((n) => n.region === 'Platform').map((n) => n.id) },
    ],
    metadata: { generatedAt: new Date().toISOString(), nodeCount: conceptNodes.length, edgeCount: relationshipEdges.length },
  }
}

/* ---- Public API ---- */

export const demoStore = {
  /* State access */
  get state() { return state },

  /* Collection CRUD */
  getCollection,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,

  /* Singletons */
  getSingleton,
  updateSingleton,

  /* Aggregations */
  getDashboardData,
  getGuestDetail,
  getVisualizationGraph,

  /* Lifecycle */
  resetState,
  exportState,
  importState,
}

export type { DemoState, CollectionKey }
