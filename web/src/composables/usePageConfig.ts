/**
 * Composable for loading a PageConfig by slug from the API.
 */

import { ref, watch, type Ref } from 'vue'
import { api } from '@/api/client'

export interface PageWidget {
  readonly widgetId: string
  readonly type: string
  readonly title?: string
  readonly conceptKey?: string
  readonly filter?: Record<string, unknown>
  readonly displayOptions?: Record<string, unknown>
}

export interface PageWidgetLayout {
  readonly widgetId: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface PageConfig {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly widgets: ReadonlyArray<PageWidget>
  readonly breakpoints?: {
    readonly desktop: ReadonlyArray<PageWidgetLayout>
    readonly tablet?: ReadonlyArray<PageWidgetLayout>
    readonly mobile?: ReadonlyArray<PageWidgetLayout>
  }
}

interface UsePageConfigReturn {
  config: Ref<PageConfig | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}

export function usePageConfig(
  slug: Ref<string> | string
): UsePageConfigReturn {
  const config = ref<PageConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    const s = typeof slug === 'string' ? slug : slug.value
    if (!s) return

    loading.value = true
    error.value = null

    try {
      const raw = await api.get<PageConfig>(
        `/api/ontology/configs/pages/${encodeURIComponent(s)}`
      )
      config.value = raw
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load page config'
      config.value = null
    } finally {
      loading.value = false
    }
  }

  reload()

  if (typeof slug !== 'string') {
    watch(slug, reload)
  }

  return { config, loading, error, reload }
}
