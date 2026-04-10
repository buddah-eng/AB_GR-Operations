import { auth } from '@/firebase'
import type { ApiResponse } from '@/types'

/* ------------------------------------------------------------------ */
/*  Concurrency-limited API client with Firebase Auth ID tokens        */
/* ------------------------------------------------------------------ */

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true' || !import.meta.env.VITE_FIREBASE_API_KEY
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
  const url = import.meta.env.VITE_API_BASE_URL ?? ''
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
/*  Public API                                                         */
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
function call<T>(
  action: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const email = DEV_BYPASS ? 'dev@localhost' : (auth.currentUser?.email ?? '')

  return enqueue<T>('POST', '/api/action', {
    action,
    params: params ?? {},
    email,
  })
}

function getActiveCount(): number {
  return activeCount
}

export const api = { get, post, put, del, call, getActiveCount }

/** @deprecated Use named import `api` instead */
export const GrApi = { call, getActiveCount }
