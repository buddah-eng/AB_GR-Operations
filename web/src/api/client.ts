import type { ApiResponse } from '@/types'

/* ------------------------------------------------------------------ */
/*  Demo mode detection                                                */
/* ------------------------------------------------------------------ */

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

/* ------------------------------------------------------------------ */
/*  Concurrency-limited API client with Firebase Auth ID tokens        */
/* ------------------------------------------------------------------ */

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'
const MAX_CONCURRENT = 8
let activeCount = 0
const queue: Array<() => void> = []

function drainQueue(): void {
  while (queue.length > 0 && activeCount < MAX_CONCURRENT) {
    const next = queue.shift()
    if (next) next()
  }
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_API_BASE_URL
  if (!url) {
    throw new Error('VITE_API_BASE_URL is not configured')
  }
  return url.endsWith('/') ? url.slice(0, -1) : url
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (DEV_BYPASS) {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dev-bypass-token',
      'X-Dev-Email': 'dev@localhost',
      'X-Dev-Role': 'director',
    }
  }

  const { auth } = await import('@/firebase')
  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new Error('No authenticated user')
  }
  const token = await currentUser.getIdToken()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const baseUrl = getBaseUrl()
  const headers = await getAuthHeaders()
  const url = `${baseUrl}${path}`

  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const response = await fetch(url, init)

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  const result: ApiResponse<T> = await response.json()

  if (result.success) {
    return result.data as T
  }

  throw new Error(result.error ?? 'Unknown server error')
}

function enqueue<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const execute = (): void => {
      activeCount++
      request<T>(method, path, body)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeCount--
          drainQueue()
        })
    }

    if (activeCount < MAX_CONCURRENT) {
      execute()
    } else {
      queue.push(execute)
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Real API (HTTP client)                                             */
/* ------------------------------------------------------------------ */

function get<T>(path: string): Promise<T> {
  return enqueue<T>('GET', path)
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return enqueue<T>('POST', path, body)
}

function put<T>(path: string, body?: unknown): Promise<T> {
  return enqueue<T>('PUT', path, body)
}

function del<T>(path: string): Promise<T> {
  return enqueue<T>('DELETE', path)
}

/**
 * Legacy call method for backward compatibility with GAS-style endpoints.
 * Sends { action, params, email } as the request body.
 */
async function call<T>(
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  let email = 'dev@localhost'
  if (!DEV_BYPASS) {
    const { auth } = await import('@/firebase')
    email = auth.currentUser?.email ?? ''
  }

  return enqueue<T>('POST', '/api/action', {
    action,
    params: params ?? {},
    email,
  })
}

function getActiveCount(): number {
  return activeCount
}

const realClient = { get, post, put, del, call, getActiveCount }

/* ------------------------------------------------------------------ */
/*  Export: demo client or real client based on env                     */
/* ------------------------------------------------------------------ */

/** Build a demo client adapter that routes to demo-store */
async function buildDemoAdapter(): Promise<typeof realClient> {
  const { demoStore } = await import('@/demo/demo-store')
  type CollectionKey = 'guests' | 'staff' | 'schedule' | 'venues' | 'pairings' | 'prepItems' | 'transport' | 'contracts'

  const PATH_TO_COLLECTION: Record<string, CollectionKey> = {
    guest: 'guests', guests: 'guests',
    staff: 'staff',
    schedule: 'schedule',
    venue: 'venues', venues: 'venues',
    pairing: 'pairings', pairings: 'pairings',
    prep: 'prepItems',
    transport: 'transport', travel: 'transport',
    contract: 'contracts', contracts: 'contracts',
  }

  function parsePathSegments(path: string): { collection: CollectionKey | null; id: string | null } {
    const segments = path.replace(/^\/api\/domains\//, '').split('/')
    const collection = PATH_TO_COLLECTION[segments[0]] ?? null
    const id = segments[1] ?? null
    return { collection, id }
  }

  function writeResult(record: Record<string, unknown>): unknown {
    return { status: 'APPLIED', write_id: `demo-${Date.now()}`, row_version: record.rowVersion ?? 1, data: record }
  }

  return {
    async get<T>(path: string): Promise<T> {
      if (path.includes('/dashboard')) return demoStore.getDashboardData() as T
      if (path.includes('/config')) return demoStore.getSingleton('config') as T
      if (path.includes('/ontology')) return demoStore.getSingleton('ontology') as T
      if (path.includes('/visualization/graph')) return demoStore.getVisualizationGraph() as T

      const { collection, id } = parsePathSegments(path)
      if (collection && id) {
        const record = demoStore.getRecord(collection, id)
        return (record ?? {}) as T
      }
      if (collection) return demoStore.getCollection(collection) as T
      return {} as T
    },

    async post<T>(path: string, body?: unknown): Promise<T> {
      const { collection } = parsePathSegments(path)
      if (collection && body) {
        const record = demoStore.createRecord(collection, body as Record<string, unknown>)
        return writeResult(record) as T
      }
      return {} as T
    },

    async put<T>(path: string, body?: unknown): Promise<T> {
      const { collection, id } = parsePathSegments(path)
      if (collection && id && body) {
        const record = demoStore.updateRecord(collection, id, body as Record<string, unknown>)
        return writeResult(record) as T
      }
      return {} as T
    },

    async del<T>(path: string): Promise<T> {
      const { collection, id } = parsePathSegments(path)
      if (collection && id) {
        demoStore.deleteRecord(collection, id)
        return { status: 'APPLIED' } as T
      }
      return {} as T
    },

    async call<T>(action: string, params?: Record<string, unknown>): Promise<T> {
      if (action === 'getUserRole') return { role: 'director' } as T
      if (action === 'getDashboardData') return demoStore.getDashboardData() as T
      if (action === 'getGuestList') return demoStore.getCollection('guests') as T
      if (action === 'getStaffList') return demoStore.getCollection('staff') as T
      if (action === 'getScheduleList') return demoStore.getCollection('schedule') as T
      if (action === 'getPrepItems') return demoStore.getCollection('prepItems') as T
      if (action === 'getGuestDetail') {
        const guestId = params?.guestId as string | undefined
        if (guestId) return (demoStore.getGuestDetail(guestId) ?? {}) as T
        return {} as T
      }

      // Write actions — route to store mutations
      if (action === 'createStaff' && params?.data) {
        const record = demoStore.createRecord('staff', params.data as Record<string, unknown>)
        return writeResult(record) as T
      }
      if (action === 'updateGuest' && params?.guestId) {
        const record = demoStore.updateRecord('guests', params.guestId as string, (params.patch ?? params) as Record<string, unknown>)
        return writeResult(record) as T
      }
      if (action === 'updatePrepItem' && params?.prepId) {
        const record = demoStore.updateRecord('prepItems', params.prepId as string, (params.patch ?? params) as Record<string, unknown>)
        return writeResult(record) as T
      }
      if (action === 'createScheduleEvent' && params?.data) {
        const record = demoStore.createRecord('schedule', params.data as Record<string, unknown>)
        return writeResult(record) as T
      }
      if (action === 'createPairing' && params?.data) {
        const record = demoStore.createRecord('pairings', params.data as Record<string, unknown>)
        return writeResult(record) as T
      }
      if (action === 'deletePairing' && params?.pairingId) {
        demoStore.deleteRecord('pairings', params.pairingId as string)
        return { status: 'APPLIED' } as T
      }
      if (action === 'createTravel' && params?.data) {
        const record = demoStore.createRecord('transport', params.data as Record<string, unknown>)
        return writeResult(record) as T
      }

      return {} as T
    },

    getActiveCount(): number {
      return 0
    },
  }
}

/** Resolved client singleton — lazily loads demo adapter if needed */
let resolvedClient: typeof realClient | null = null

function getClient(): typeof realClient {
  if (resolvedClient) return resolvedClient
  return realClient
}

/** Call once at app startup (in main.ts) to eagerly load the demo adapter */
export async function initDemoClient(): Promise<void> {
  if (DEMO_MODE) {
    resolvedClient = await buildDemoAdapter()
  }
}

/* ------------------------------------------------------------------ */
/*  Public API — proxy through resolved client                         */
/* ------------------------------------------------------------------ */

export const api = {
  get<T>(path: string): Promise<T> {
    return getClient().get<T>(path)
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return getClient().post<T>(path, body)
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return getClient().put<T>(path, body)
  },
  del<T>(path: string): Promise<T> {
    return getClient().del<T>(path)
  },
  call<T>(action: string, params?: Record<string, unknown>): Promise<T> {
    return getClient().call<T>(action, params)
  },
  getActiveCount(): number {
    return getClient().getActiveCount()
  },
}

export const isDemoMode = DEMO_MODE

/** @deprecated Use named import `api` instead */
export const GrApi = { call: api.call, getActiveCount: api.getActiveCount }
