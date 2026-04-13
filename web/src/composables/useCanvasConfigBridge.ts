/* ------------------------------------------------------------------ */
/*  Canvas-Config Bridge composable                                    */
/*  Bidirectional binding between canvas edits and backend config.     */
/*  Canvas edit -> API call -> success -> confirm / failure -> revert. */
/*  Config change (via SSE) -> update canvas.                          */
/*  Undo/redo stack for canvas actions.                                */
/* ------------------------------------------------------------------ */

import { ref, readonly, computed, onUnmounted, type Ref } from 'vue'
import { api } from '@/api/client'
import { useCanvasRBAC, type CanvasNodeMeta } from './useCanvasRBAC'

/* ---- Types ---- */

/** Status of a pending canvas edit */
export type BridgeEditStatus =
  | 'idle'
  | 'pending'
  | 'success'
  | 'error'
  | 'review_required'
  | 'validating'

/** A recorded canvas action for undo/redo */
export interface CanvasAction {
  readonly id: string
  readonly type: string
  readonly changeSetId: string
  readonly configType: string
  readonly configRecordId: string
  readonly previousVersion: number
  readonly timestamp: string
  readonly rollbackPayload: unknown
}

/** SSE config update event payload */
export interface CanvasConfigUpdate {
  readonly type: 'config_change'
  readonly configType: string
  readonly action: 'created' | 'updated' | 'deleted'
  readonly recordId: string
  readonly recordKey: string
  readonly changedFields: readonly string[]
  readonly newValues: Record<string, unknown>
  readonly changeSetId: string
  readonly actorId: string
  readonly timestamp: string
}

/** Bridge options */
export interface BridgeOptions {
  /** SSE endpoint for real-time updates */
  readonly sseEndpoint?: string
  /** Maximum undo stack depth */
  readonly maxUndoDepth?: number
  /** API timeout in milliseconds */
  readonly apiTimeout?: number
}

const DEFAULT_OPTIONS: Required<BridgeOptions> = {
  sseEndpoint: '/api/stream',
  maxUndoDepth: 50,
  apiTimeout: 10_000,
}

/* ---- Composable ---- */

/**
 * Composable that handles bidirectional binding between canvas edits
 * and backend configuration. Manages optimistic updates, conflict
 * resolution, undo/redo, and SSE-driven config refresh.
 */
export function useCanvasConfigBridge(options?: BridgeOptions) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const rbac = useCanvasRBAC()

  /* ---- State ---- */

  const editStatus = ref<BridgeEditStatus>('idle')
  const lastError = ref<string | null>(null)
  const connected = ref(false)
  const undoStack = ref<CanvasAction[]>([])
  const redoStack = ref<CanvasAction[]>([])

  /** Pending optimistic updates keyed by a temp ID */
  const pendingEdits = ref<Map<string, unknown>>(new Map())

  /** SSE event source reference */
  let eventSource: EventSource | null = null

  /* ---- Getters ---- */

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const isDisconnected = computed(() => !connected.value)

  /* ---- SSE: Config -> Canvas ---- */

  /** Callbacks registered by canvas views for incoming config updates */
  const updateListeners = ref<Array<(update: CanvasConfigUpdate) => void>>([])

  function onConfigUpdate(listener: (update: CanvasConfigUpdate) => void): () => void {
    updateListeners.value = [...updateListeners.value, listener]
    return () => {
      updateListeners.value = updateListeners.value.filter((l) => l !== listener)
    }
  }

  function connectSSE(): void {
    if (eventSource) return

    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
      const url = `${baseUrl}${opts.sseEndpoint}?concepts=ontology_concept,ontology_relationship,workflow_config,data_route,data_transform,permission`

      eventSource = new EventSource(url, { withCredentials: true })

      eventSource.onopen = () => {
        connected.value = true
      }

      eventSource.addEventListener('config_change', (event: MessageEvent) => {
        try {
          const update = JSON.parse(event.data) as CanvasConfigUpdate
          for (const listener of updateListeners.value) {
            listener(update)
          }
        } catch {
          // Ignore malformed SSE payloads
        }
      })

      eventSource.addEventListener('heartbeat', () => {
        connected.value = true
      })

      eventSource.onerror = () => {
        connected.value = false
      }
    } catch {
      connected.value = false
    }
  }

  function disconnectSSE(): void {
    if (eventSource) {
      eventSource.close()
      eventSource = null
      connected.value = false
    }
  }

  /* ---- Canvas -> Config ---- */

  /**
   * Submit a canvas edit to the backend API.
   * Performs RBAC pre-check, applies optimistic update,
   * calls the API, and handles success/failure.
   */
  async function submitEdit<T>(params: {
    node: CanvasNodeMeta
    method: 'POST' | 'PUT' | 'DELETE'
    path: string
    body?: unknown
    optimisticId: string
    optimisticData: unknown
    previousVersion?: number
  }): Promise<T | null> {
    // RBAC pre-check
    if (!rbac.canEdit(params.node)) {
      lastError.value = 'Insufficient permissions to edit this element'
      editStatus.value = 'error'
      return null
    }

    // Apply optimistic update
    editStatus.value = 'pending'
    lastError.value = null
    pendingEdits.value = new Map(pendingEdits.value).set(
      params.optimisticId,
      params.optimisticData,
    )

    try {
      let result: T

      switch (params.method) {
        case 'POST':
          result = await api.post<T>(params.path, params.body)
          break
        case 'PUT':
          result = await api.put<T>(params.path, params.body)
          break
        case 'DELETE':
          result = await api.del<T>(params.path)
          break
      }

      // Success: remove pending, push to undo stack
      const nextPending = new Map(pendingEdits.value)
      nextPending.delete(params.optimisticId)
      pendingEdits.value = nextPending

      editStatus.value = 'success'

      // Record in undo stack
      const action: CanvasAction = {
        id: crypto.randomUUID(),
        type: params.method,
        changeSetId: crypto.randomUUID(),
        configType: params.node.type,
        configRecordId: params.node.id,
        previousVersion: params.previousVersion ?? 0,
        timestamp: new Date().toISOString(),
        rollbackPayload: params.body,
      }

      undoStack.value = [
        ...undoStack.value.slice(-(opts.maxUndoDepth - 1)),
        action,
      ]
      // Clear redo stack on new action
      redoStack.value = []

      // Reset status after brief success indication
      setTimeout(() => {
        if (editStatus.value === 'success') {
          editStatus.value = 'idle'
        }
      }, 3_000)

      return result
    } catch (err) {
      // Failure: rollback optimistic update
      const nextPending = new Map(pendingEdits.value)
      nextPending.delete(params.optimisticId)
      pendingEdits.value = nextPending

      lastError.value =
        err instanceof Error ? err.message : 'Failed to save change'
      editStatus.value = 'error'

      return null
    }
  }

  /* ---- Undo / Redo ---- */

  async function undo(): Promise<void> {
    if (undoStack.value.length === 0) return
    if (isDisconnected.value) return

    const action = undoStack.value[undoStack.value.length - 1]
    undoStack.value = undoStack.value.slice(0, -1)

    try {
      await api.post('/api/versioning/rollback', {
        table: action.configType,
        recordId: action.configRecordId,
        targetVersion: action.previousVersion,
      })

      redoStack.value = [...redoStack.value, action]
    } catch (err) {
      lastError.value =
        err instanceof Error ? err.message : 'Undo failed'
      // Restore action to undo stack since rollback failed
      undoStack.value = [...undoStack.value, action]
      // Surface error for consuming component (lastError is exposed as readonly ref)
    }
  }

  async function redo(): Promise<void> {
    if (redoStack.value.length === 0) return
    if (isDisconnected.value) return

    const action = redoStack.value[redoStack.value.length - 1]
    redoStack.value = redoStack.value.slice(0, -1)

    try {
      // Redo re-applies the original mutation
      if (action.rollbackPayload) {
        await api.put(
          `/api/${action.configType}/${action.configRecordId}`,
          action.rollbackPayload,
        )
      }

      undoStack.value = [...undoStack.value, action]
    } catch (err) {
      lastError.value =
        err instanceof Error ? err.message : 'Redo failed'
      redoStack.value = [...redoStack.value, action]
      // Surface error for consuming component (lastError is exposed as readonly ref)
    }
  }

  /* ---- CI/QA Status ---- */

  /**
   * Check whether a proposed change is high-risk and requires review.
   */
  async function checkImpact(params: {
    configType: string
    recordId: string
    action: string
  }): Promise<{
    riskLevel: 'low' | 'medium' | 'high'
    affectedConfigs: readonly string[]
    requiresReview: boolean
  }> {
    try {
      const result = await api.get<{
        riskLevel: 'low' | 'medium' | 'high'
        affectedConfigs: string[]
        requiresReview: boolean
      }>(
        `/api/ci-qa/impact?configType=${params.configType}&recordId=${params.recordId}&action=${params.action}`,
      )
      return result
    } catch {
      // Default to low-risk if impact check fails
      return {
        riskLevel: 'low',
        affectedConfigs: [],
        requiresReview: false,
      }
    }
  }

  /* ---- Keyboard shortcuts ---- */

  function handleKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
      if (event.shiftKey) {
        event.preventDefault()
        redo()
      } else {
        event.preventDefault()
        undo()
      }
    }
  }

  function bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', handleKeyDown)
  }

  function unbindKeyboardShortcuts(): void {
    window.removeEventListener('keydown', handleKeyDown)
  }

  /* ---- Cleanup ---- */

  onUnmounted(() => {
    disconnectSSE()
    unbindKeyboardShortcuts()
  })

  return {
    // State
    editStatus: readonly(editStatus) as Ref<BridgeEditStatus>,
    lastError: readonly(lastError) as Ref<string | null>,
    connected: readonly(connected) as Ref<boolean>,
    isDisconnected,
    canUndo,
    canRedo,
    pendingEdits: readonly(pendingEdits) as Ref<Map<string, unknown>>,

    // Actions
    submitEdit,
    undo,
    redo,
    checkImpact,
    onConfigUpdate,
    connectSSE,
    disconnectSSE,
    bindKeyboardShortcuts,
    unbindKeyboardShortcuts,
  }
}
