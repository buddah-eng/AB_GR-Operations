import { ref, type Ref } from 'vue'
import { api } from '@/api/client'

interface UseConceptDataOptions {
  filters?: Record<string, unknown>
  sort?: { field: string; direction: 'asc' | 'desc' }
  page?: number
  limit?: number
}

interface UseConceptDataReturn {
  records: Ref<Record<string, unknown>[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  total: Ref<number>
  reload: () => Promise<void>
}

export function useConceptData(
  conceptKey: Ref<string> | string,
  options?: Ref<UseConceptDataOptions> | UseConceptDataOptions
): UseConceptDataReturn {
  const records = ref<Record<string, unknown>[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const total = ref(0)

  async function reload(): Promise<void> {
    const key = typeof conceptKey === 'string' ? conceptKey : conceptKey.value
    if (!key) return

    loading.value = true
    error.value = null

    try {
      const opts = options && 'value' in options ? options.value : options
      const params = new URLSearchParams()
      if (opts?.page) params.set('page', String(opts.page))
      if (opts?.limit) params.set('limit', String(opts.limit))
      if (opts?.sort) {
        params.set('sortBy', opts.sort.field)
        params.set('sortDir', opts.sort.direction)
      }
      if (opts?.filters) {
        for (const [k, v] of Object.entries(opts.filters)) {
          if (v !== null && v !== undefined) {
            params.set(`filter.${k}`, String(v))
          }
        }
      }

      const qs = params.toString()
      const path = `/api/domains/${key}${qs ? `?${qs}` : ''}`
      const result = await api.get<unknown>(path)

      // Handle both response formats:
      // Real backend: data is array (unwrapped from ApiResponse), meta in response
      // Shim: data is { records: [...], total: N }
      if (Array.isArray(result)) {
        records.value = result as Record<string, unknown>[]
      } else {
        const obj = result as Record<string, unknown>
        records.value = (obj.records as Record<string, unknown>[]) ?? []
      }
      total.value = Array.isArray(result)
        ? records.value.length
        : ((result as Record<string, unknown>).total as number) ?? records.value.length
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load data'
      records.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  reload()

  return { records, loading, error, total, reload }
}
