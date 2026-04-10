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
    // In demo mode, API is at the same origin
    return ''
  }
  return url.endsWith('/') ? url.slice(0, -1) : url
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (DEMO_MODE || DEV_BYPASS) {
    return {
      'Content-Type': 'application/json',
      Authorization: 'Bearer demo-token',
      'X-Dev-Email': 'demo-director@animeboston.org',
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

/* ------------------------------------------------------------------ */
/*  Demo mode: reads from real API, writes to localStorage              */
/* ------------------------------------------------------------------ */

const DEMO_WRITES_KEY = 'gr-ops-demo-writes'

/** Load local write overrides from localStorage */
function loadLocalWrites(): Record<string, Record<string, unknown>[]> {
  try {
    const stored = localStorage.getItem(DEMO_WRITES_KEY)
    return stored ? JSON.parse(stored) as Record<string, Record<string, unknown>[]> : {}
  } catch {
    return {}
  }
}

/** Save local write overrides to localStorage */
function saveLocalWrites(writes: Record<string, Record<string, unknown>[]>): void {
  try {
    localStorage.setItem(DEMO_WRITES_KEY, JSON.stringify(writes))
  } catch {
    // QuotaExceeded — silently fail
  }
}

/** Generate a demo ID */
function demoId(prefix: string): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return `${prefix}-demo-${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

function writeResult(record?: Record<string, unknown>): unknown {
  return {
    status: 'APPLIED',
    write_id: demoId('w'),
    row_version: (record?.rowVersion as number ?? 0) + 1,
    data: record ?? {},
  }
}

/** Detect if an action is a read or write */
function isReadAction(action: string): boolean {
  return [
    'getUserRole', 'getDashboardData', 'getGuestList', 'getStaffList',
    'getScheduleList', 'getPrepItems', 'getGuestDetail',
  ].includes(action)
}

/**
 * Demo adapter: GET/read actions → real HTTP API (Vercel Functions → Postgres)
 * POST/PUT/DELETE/write actions → localStorage
 */
function buildDemoAdapter(): typeof realClient {
  return {
    // Reads pass through to real API
    get<T>(path: string): Promise<T> {
      return enqueue<T>('GET', path)
    },

    // Writes go to localStorage
    async post<T>(path: string, body?: unknown): Promise<T> {
      const writes = loadLocalWrites()
      const key = path.replace(/^\/api\/domains\//, '').split('/')[0] ?? 'unknown'
      const record = { ...(body as Record<string, unknown> ?? {}), id: demoId(key.charAt(0)) }
      writes[key] = [...(writes[key] ?? []), record]
      saveLocalWrites(writes)
      return writeResult(record) as T
    },

    async put<T>(_path: string, body?: unknown): Promise<T> {
      return writeResult(body as Record<string, unknown>) as T
    },

    async del<T>(_path: string): Promise<T> {
      return { status: 'APPLIED' } as T
    },

    // Call: reads go to real API, writes go to localStorage
    async call<T>(action: string, params?: Record<string, unknown>): Promise<T> {
      if (action === 'getUserRole') {
        return { role: 'director' } as T
      }

      // Read actions → real API via POST /api/action
      if (isReadAction(action)) {
        return enqueue<T>('POST', '/api/action', {
          action,
          params: params ?? {},
          email: 'demo-director@animeboston.org',
        })
      }

      // Write actions → localStorage
      return writeResult() as T
    },

    getActiveCount(): number {
      return activeCount
    },
  }
}

/** Resolved client singleton */
let resolvedClient: typeof realClient | null = null

function getClient(): typeof realClient {
  if (resolvedClient) return resolvedClient
  return realClient
}

/** Call once at app startup (in main.ts) to initialize demo adapter */
export async function initDemoClient(): Promise<void> {
  if (DEMO_MODE) {
    resolvedClient = buildDemoAdapter()
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
