import guestsData from './data/guests.json'
import staffData from './data/staff.json'
import scheduleData from './data/schedule.json'
import venuesData from './data/venues.json'
import pairingsData from './data/pairings.json'
import prepItemsData from './data/prep-items.json'
import transportData from './data/transport.json'
import contractsData from './data/contracts.json'
import ontologyData from './data/ontology.json'
import configData from './data/config.json'
import { useDemoState } from './demo-state'
import type { GuestSummary, PrepItem, ScheduleEvent } from '@/types'

/* ------------------------------------------------------------------ */
/*  Demo API client — returns seed data instead of making HTTP calls   */
/* ------------------------------------------------------------------ */

/** Small delay to simulate network latency */
function simulateLatency(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 120))
}

/** Deep clone to prevent mutation of seed data */
function clone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data)) as T
}

/** Match a URL path against a pattern prefix */
function matchPath(url: string, pattern: string): boolean {
  return url === pattern || url.startsWith(pattern + '/')
}

/** Extract an ID segment from a URL path */
function extractId(url: string, prefix: string): string | null {
  if (!url.startsWith(prefix + '/')) return null
  const rest = url.slice(prefix.length + 1)
  const segment = rest.split('/')[0] ?? null
  return segment || null
}

/** Build dashboard summary from seed data */
function buildDashboardData(): Record<string, unknown> {
  const demoState = useDemoState()
  const guests = demoState.adjustGuestStatuses(
    clone(guestsData) as GuestSummary[],
  )
  const preps = demoState.adjustPrepItems(
    clone(prepItemsData) as PrepItem[],
  )

  const totalGuests = guests.length
  const confirmedGuests = guests.filter(
    (g) => g.status === 'confirmed' || g.status === 'arrived' || g.status === 'attending',
  ).length
  const jpGuests = guests.filter((g) => g.type === 'JP').length
  const naGuests = guests.filter((g) => g.type === 'NA').length

  const totalPrep = preps.length
  const completedPrep = preps.filter((p) => p.status === 'complete').length
  const prepPercent = totalPrep > 0 ? Math.round((completedPrep / totalPrep) * 100) : 0

  const totalEvents = scheduleData.length
  const confirmedEvents = scheduleData.filter((e) => e.status === 'confirmed').length

  return {
    guests: {
      total: totalGuests,
      confirmed: confirmedGuests,
      jp: jpGuests,
      na: naGuests,
      byDepartment: groupBy(guests as unknown as ReadonlyArray<Record<string, unknown>>, 'department'),
      byStatus: groupBy(guests as unknown as ReadonlyArray<Record<string, unknown>>, 'status'),
    },
    schedule: {
      total: totalEvents,
      confirmed: confirmedEvents,
      byDay: {
        '2026-04-03': scheduleData.filter((e) => e.date === '2026-04-03').length,
        '2026-04-04': scheduleData.filter((e) => e.date === '2026-04-04').length,
        '2026-04-05': scheduleData.filter((e) => e.date === '2026-04-05').length,
      },
    },
    prep: {
      total: totalPrep,
      completed: completedPrep,
      percent: prepPercent,
      inProgress: preps.filter((p) => p.status === 'in_progress').length,
      notStarted: preps.filter((p) => p.status === 'not_started').length,
    },
    staffing: {
      total: staffData.length,
      byRole: groupBy(staffData, 'role'),
      byDepartment: groupBy(staffData, 'department'),
    },
    violations: {
      total: 0,
      items: [],
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
    const value = String((item as Record<string, unknown>)[key] ?? 'Unknown')
    result[value] = (result[value] ?? 0) + 1
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Route handler: GET                                                 */
/* ------------------------------------------------------------------ */

function handleGet(url: string): unknown {
  const demoState = useDemoState()

  // Dashboard
  if (matchPath(url, '/api/dashboard')) {
    return buildDashboardData()
  }

  // Config
  if (matchPath(url, '/api/config')) {
    return clone(configData)
  }

  // Ontology
  if (matchPath(url, '/api/ontology')) {
    return clone(ontologyData)
  }

  // Visualization graph
  if (matchPath(url, '/api/visualization/graph')) {
    return buildVisualizationGraph()
  }

  // Guest detail by ID
  const guestId = extractId(url, '/api/domains/guest')
  if (guestId) {
    const guest = guestsData.find((g) => g.guestId === guestId)
    if (guest) {
      const adjusted = demoState.adjustGuestStatus(
        clone(guest) as GuestSummary,
      )
      return {
        guest: adjusted,
        schedule: scheduleData.filter((e) => e.guestId === guestId),
        travel: transportData.filter((t) => t.guestId === guestId),
        accommodations: [],
        dietary: [],
        autographs: [],
        prepTracker: prepItemsData.filter((p) => p.guestId === guestId),
        pairings: pairingsData.filter((p) => p.guestId === guestId),
        violations: [],
      }
    }
  }

  // Guest list
  if (matchPath(url, '/api/domains/guest')) {
    return demoState.adjustGuestStatuses(clone(guestsData) as GuestSummary[])
  }

  // Staff list
  if (matchPath(url, '/api/domains/staff')) {
    return clone(staffData)
  }

  // Schedule
  if (matchPath(url, '/api/domains/schedule')) {
    return demoState.adjustScheduleEvents(clone(scheduleData) as ScheduleEvent[])
  }

  // Venues
  if (matchPath(url, '/api/domains/venues') || matchPath(url, '/api/domains/venue')) {
    return clone(venuesData)
  }

  // Pairings
  if (matchPath(url, '/api/domains/pairings') || matchPath(url, '/api/domains/pairing')) {
    return clone(pairingsData)
  }

  // Prep tracker
  if (matchPath(url, '/api/domains/prep')) {
    return demoState.adjustPrepItems(clone(prepItemsData) as PrepItem[])
  }

  // Transport / travel
  if (matchPath(url, '/api/domains/transport') || matchPath(url, '/api/domains/travel')) {
    return demoState.adjustTransportStatus(clone(transportData) as Array<Record<string, unknown>>)
  }

  // Contracts
  if (matchPath(url, '/api/domains/contract')) {
    return clone(contractsData)
  }

  // User role (for auth)
  if (matchPath(url, '/api/action')) {
    return { role: 'director' }
  }

  // Fallback: return empty array for any unknown domain list
  if (url.startsWith('/api/domains/')) {
    return []
  }

  // Fallback: return empty object
  return {}
}

/* ------------------------------------------------------------------ */
/*  Visualization graph builder                                        */
/* ------------------------------------------------------------------ */

function buildVisualizationGraph(): Record<string, unknown> {
  // System-level ontology graph: concepts as nodes, relationships as edges
  // This shows the ARCHITECTURE, not individual records
  const conceptNodes = [
    {
      id: 'concept-guest',
      type: 'concept' as const,
      label: 'Guest',
      sourceId: 'guest',
      sourceTable: 'ontology_concepts',
      region: 'GR Core',
      properties: { icon: 'pi pi-user', propertyCount: 12, recordCount: guestsData.length },
    },
    {
      id: 'concept-staff',
      type: 'concept' as const,
      label: 'Staff',
      sourceId: 'staff',
      sourceTable: 'ontology_concepts',
      region: 'GR Core',
      properties: { icon: 'pi pi-users', propertyCount: 8, recordCount: staffData.length },
    },
    {
      id: 'concept-pairing',
      type: 'concept' as const,
      label: 'Pairing',
      sourceId: 'pairing',
      sourceTable: 'ontology_concepts',
      region: 'GR Core',
      properties: { icon: 'pi pi-link', propertyCount: 5, recordCount: pairingsData.length },
    },
    {
      id: 'concept-event',
      type: 'concept' as const,
      label: 'Schedule Event',
      sourceId: 'schedule_event',
      sourceTable: 'ontology_concepts',
      region: 'Operations',
      properties: { icon: 'pi pi-calendar', propertyCount: 10, recordCount: scheduleData.length },
    },
    {
      id: 'concept-venue',
      type: 'concept' as const,
      label: 'Venue',
      sourceId: 'venue',
      sourceTable: 'ontology_concepts',
      region: 'Operations',
      properties: { icon: 'pi pi-building', propertyCount: 6, recordCount: venuesData.length },
    },
    {
      id: 'concept-prep',
      type: 'concept' as const,
      label: 'Prep Item',
      sourceId: 'prep_item',
      sourceTable: 'ontology_concepts',
      region: 'GR Core',
      properties: { icon: 'pi pi-check-square', propertyCount: 7, recordCount: prepItemsData.length },
    },
    {
      id: 'concept-transport',
      type: 'concept' as const,
      label: 'Transport',
      sourceId: 'transport',
      sourceTable: 'ontology_concepts',
      region: 'Logistics',
      properties: { icon: 'pi pi-car', propertyCount: 9, recordCount: transportData.length },
    },
    {
      id: 'concept-contract',
      type: 'concept' as const,
      label: 'Contract',
      sourceId: 'contract',
      sourceTable: 'ontology_concepts',
      region: 'GR Core',
      properties: { icon: 'pi pi-file', propertyCount: 8, recordCount: contractsData.length },
    },
    {
      id: 'concept-convention',
      type: 'concept' as const,
      label: 'Convention',
      sourceId: 'convention',
      sourceTable: 'ontology_concepts',
      region: 'Platform',
      properties: { icon: 'pi pi-globe', propertyCount: 6, recordCount: 1 },
    },
    {
      id: 'concept-registry',
      type: 'concept' as const,
      label: 'Guest Registry',
      sourceId: 'guest_registry',
      sourceTable: 'ontology_concepts',
      region: 'Platform',
      properties: { icon: 'pi pi-database', propertyCount: 10, recordCount: 0 },
    },
  ]

  const relationshipEdges = [
    { id: 'rel-guest-pairing', type: 'relationship' as const, sourceNodeId: 'concept-guest', targetNodeId: 'concept-pairing', label: 'assigned via', properties: { cardinality: '1:N' } },
    { id: 'rel-staff-pairing', type: 'relationship' as const, sourceNodeId: 'concept-staff', targetNodeId: 'concept-pairing', label: 'assigned via', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-event', type: 'relationship' as const, sourceNodeId: 'concept-guest', targetNodeId: 'concept-event', label: 'participates in', properties: { cardinality: '1:N' } },
    { id: 'rel-venue-event', type: 'relationship' as const, sourceNodeId: 'concept-venue', targetNodeId: 'concept-event', label: 'hosts', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-prep', type: 'relationship' as const, sourceNodeId: 'concept-guest', targetNodeId: 'concept-prep', label: 'tracked by', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-transport', type: 'relationship' as const, sourceNodeId: 'concept-guest', targetNodeId: 'concept-transport', label: 'booked for', properties: { cardinality: '1:N' } },
    { id: 'rel-guest-contract', type: 'relationship' as const, sourceNodeId: 'concept-guest', targetNodeId: 'concept-contract', label: 'bound by', properties: { cardinality: '1:1' } },
    { id: 'rel-convention-guest', type: 'relationship' as const, sourceNodeId: 'concept-convention', targetNodeId: 'concept-guest', label: 'invites', properties: { cardinality: '1:N' } },
    { id: 'rel-convention-venue', type: 'relationship' as const, sourceNodeId: 'concept-convention', targetNodeId: 'concept-venue', label: 'uses', properties: { cardinality: '1:N' } },
    { id: 'rel-registry-guest', type: 'relationship' as const, sourceNodeId: 'concept-registry', targetNodeId: 'concept-guest', label: 'pre-populates', properties: { cardinality: '1:N' } },
  ]

  const regions = [
    { id: 'region-gr-core', label: 'GR Core', color: '#3b82f6', nodeIds: conceptNodes.filter((n) => n.region === 'GR Core').map((n) => n.id) },
    { id: 'region-operations', label: 'Operations', color: '#10b981', nodeIds: conceptNodes.filter((n) => n.region === 'Operations').map((n) => n.id) },
    { id: 'region-logistics', label: 'Logistics', color: '#f59e0b', nodeIds: conceptNodes.filter((n) => n.region === 'Logistics').map((n) => n.id) },
    { id: 'region-platform', label: 'Platform', color: '#8b5cf6', nodeIds: conceptNodes.filter((n) => n.region === 'Platform').map((n) => n.id) },
  ]

  return {
    nodes: conceptNodes,
    edges: relationshipEdges,
    regions,
    metadata: {
      generatedAt: new Date().toISOString(),
      nodeCount: conceptNodes.length,
      edgeCount: relationshipEdges.length,
    },
  }
}

function getDepartmentColor(dept: string): string {
  const colors: Record<string, string> = {
    Anime: '#ef4444',
    Music: '#8b5cf6',
    Cosplay: '#ec4899',
    Panels: '#f59e0b',
    Gaming: '#22c55e',
    Artists: '#06b6d4',
    Industry: '#6366f1',
  }
  return colors[dept] ?? '#94a3b8'
}

/* ------------------------------------------------------------------ */
/*  Public demo client matching the real api interface                  */
/* ------------------------------------------------------------------ */

export const demoClient = {
  async get<T>(path: string): Promise<T> {
    await simulateLatency()
    return handleGet(path) as T
  },

  async post<T>(_path: string, body?: unknown): Promise<T> {
    await simulateLatency()
    return (body ?? {}) as T
  },

  async put<T>(_path: string, body?: unknown): Promise<T> {
    await simulateLatency()
    return (body ?? {}) as T
  },

  async del<T>(_path: string): Promise<T> {
    await simulateLatency()
    return {} as T
  },

  async call<T>(
    action: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    await simulateLatency()
    const demoState = useDemoState()

    if (action === 'getUserRole') {
      return { role: 'director' } as T
    }

    if (action === 'getDashboardData') {
      return buildDashboardData() as T
    }

    if (action === 'getGuestList') {
      return demoState.adjustGuestStatuses(
        clone(guestsData) as GuestSummary[],
      ) as T
    }

    if (action === 'getStaffList') {
      return clone(staffData) as T
    }

    if (action === 'getScheduleList') {
      return demoState.adjustScheduleEvents(
        clone(scheduleData) as ScheduleEvent[],
      ) as T
    }

    if (action === 'getPrepItems') {
      return demoState.adjustPrepItems(
        clone(prepItemsData) as PrepItem[],
      ) as T
    }

    if (action === 'getGuestDetail') {
      const guestId = params?.guestId as string | undefined
      if (guestId) {
        const guest = guestsData.find((g) => g.guestId === guestId)
        if (guest) {
          const adjusted = demoState.adjustGuestStatus(
            clone(guest) as GuestSummary,
          )
          return {
            guest: adjusted,
            schedule: scheduleData.filter((e) => e.guestId === guestId),
            travel: transportData.filter((t) => t.guestId === guestId),
            accommodations: [],
            dietary: [],
            autographs: [],
            prepTracker: prepItemsData.filter((p) => p.guestId === guestId),
            pairings: pairingsData.filter((p) => p.guestId === guestId),
            violations: [],
          } as T
        }
      }
      return {} as T
    }

    // Write operations — return success with demo toast
    return {} as T
  },

  getActiveCount(): number {
    return 0
  },
}
