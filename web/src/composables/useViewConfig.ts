/**
 * Composable for loading a named ViewConfig from the API.
 * Transforms backend shape to frontend ViewConfig via the config adapter.
 */

import { ref, watch, type Ref } from 'vue'
import { api } from '@/api/client'
import type { ViewConfig } from '@/types/views'
import { adaptViewConfig } from './useConfigAdapter'

interface UseViewConfigReturn {
  config: Ref<ViewConfig | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}

export function useViewConfig(
  conceptKey: Ref<string> | string,
  viewName: Ref<string> | string
): UseViewConfigReturn {
  const config = ref<ViewConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    const concept = typeof conceptKey === 'string' ? conceptKey : conceptKey.value
    const name = typeof viewName === 'string' ? viewName : viewName.value
    if (!concept || !name) return

    loading.value = true
    error.value = null

    try {
      const raw = await api.get<Record<string, unknown>>(
        `/api/ontology/configs/views/${encodeURIComponent(concept)}/${encodeURIComponent(name)}`
      )
      config.value = adaptViewConfig(raw)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load view config'
      config.value = null
    } finally {
      loading.value = false
    }
  }

  // Load on mount
  reload()

  // Re-load if reactive args change
  if (typeof conceptKey !== 'string') {
    watch(conceptKey, reload)
  }
  if (typeof viewName !== 'string') {
    watch(viewName, reload)
  }

  return { config, loading, error, reload }
}
