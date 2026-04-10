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
      byDepartment: groupBy(guests, 'department'),
      byStatus: groupBy(guests, 'status'),
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

function groupBy<T extends Record<string, unknown>>(
  items: T[],
  key: string,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of items) {
    const value = String(item[key] ?? 'Unknown')
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
  const nodes = guestsData.map((g) => ({
    id: g.guestId,
    type: 'concept' as const,
    label: g.name,
    sourceId: g.guestId,
    sourceTable: 'guest',
    region: g.department,
    properties: { type: g.type, status: g.status, department: g.department },
  }))

  const staffNodes = staffData.slice(0, 8).map((s) => ({
    id: s.staffId,
    type: 'concept' as const,
    label: s.name,
    sourceId: s.staffId,
    sourceTable: 'staff',
    region: s.department,
    properties: { role: s.role, department: s.department },
  }))

  const edges = pairingsData.map((p) => ({
    id: p.pairingId,
    type: 'relationship' as const,
    sourceNodeId: p.guestId,
    targetNodeId: p.staffId,
    label: p.role,
    properties: { status: p.status },
  }))

  const allNodes = [...nodes, ...staffNodes]

  const departments = [...new Set(guestsData.map((g) => g.department))]
  const regions = departments.map((dept) => ({
    id: `region-${dept.toLowerCase()}`,
    label: dept,
    color: getDepartmentColor(dept),
    nodeIds: allNodes
      .filter((n) => n.region === dept)
      .map((n) => n.id),
  }))

  return {
    nodes: allNodes,
    edges,
    regions,
    metadata: {
      generatedAt: new Date().toISOString(),
      nodeCount: allNodes.length,
      edgeCount: edges.length,
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
    _params?: Record<string, unknown>,
  ): Promise<T> {
    await simulateLatency()

    if (action === 'getUserRole') {
      return { role: 'director' } as T
    }

    return {} as T
  },

  getActiveCount(): number {
    return 0
  },
}
