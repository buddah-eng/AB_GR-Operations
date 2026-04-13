<template>
  <div class="rounded-lg border border-surface-200 bg-surface-0 p-4 shadow-sm">
    <h3 class="text-sm font-medium text-surface-500 mb-2">{{ widget.title }}</h3>

    <!-- Stat card -->
    <div
      v-if="widget.type === 'stat_card'"
      class="text-3xl font-bold text-surface-900 cursor-pointer hover:shadow-md transition-shadow rounded-md p-1 -m-1"
      @click="handleWidgetClick"
    >
      <span v-if="loading" class="inline-block h-9 w-16 bg-surface-200 rounded animate-pulse" />
      <span v-else>{{ count }}</span>
    </div>

    <!-- Action banner / alert list -->
    <div v-else-if="widget.type === 'action_banner'" class="space-y-2">
      <div v-if="loading" class="space-y-2">
        <div class="h-5 bg-surface-200 rounded animate-pulse" v-for="n in 3" :key="n" />
      </div>
      <div
        v-else-if="records.length === 0"
        class="text-sm text-surface-400"
      >
        No action items
      </div>
      <div
        v-for="rec in records.slice(0, 5)"
        :key="rec.id as string"
        class="flex items-center gap-2 text-sm"
      >
        <i class="pi pi-angle-right text-accent-500" />
        <span class="text-surface-700">{{ (rec.properties as Record<string, unknown>)?.name ?? rec.name ?? rec.id }}</span>
      </div>
    </div>

    <!-- Prep progress -->
    <div v-else-if="widget.type === 'prep_progress'">
      <span v-if="loading" class="inline-block h-9 w-16 bg-surface-200 rounded animate-pulse" />
      <div v-else class="flex items-center gap-3">
        <ProgressBar :value="progressPct" class="flex-1" />
        <span class="text-sm font-medium text-surface-700">{{ progressPct }}%</span>
      </div>
    </div>

    <!-- Activity feed -->
    <div v-else-if="widget.type === 'activity_feed'" class="space-y-2">
      <div v-if="loading" class="space-y-2">
        <div class="h-4 bg-surface-200 rounded animate-pulse" v-for="n in 4" :key="n" />
      </div>
      <div v-else-if="activityItems.length === 0" class="text-sm text-surface-400">
        No recent activity
      </div>
      <div
        v-for="item in activityItems"
        :key="item.id"
        class="flex items-center gap-2 text-sm"
      >
        <i :class="[item.icon, item.iconColor]" style="font-size: 10px" />
        <span class="text-surface-700">{{ item.summary }}</span>
        <span class="text-surface-400 ml-auto text-xs whitespace-nowrap">{{ item.timeAgo }}</span>
      </div>
    </div>

    <!-- Fallback -->
    <div v-else class="text-sm text-surface-400">
      Widget: {{ widget.type }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import ProgressBar from 'primevue/progressbar'
import { api } from '@/api/client'
import { CONCEPT_LIST_ROUTES } from '@/utils/routes'
import type { PageWidget } from '@/composables/usePageConfig'

const router = useRouter()

type TimeScope = 'all' | 'today' | 'week'

const props = defineProps<{
  widget: PageWidget
  refreshKey?: number
  timeScope?: TimeScope
}>()

const count = ref(0)
const records = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const progressPct = ref(0)
const activityItems = ref<Array<{ id: string; summary: string; timeAgo: string; icon: string; iconColor: string }>>([])

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const STATUS_ICON_MAP: Record<string, { icon: string; color: string }> = {
  confirmed: { icon: 'pi pi-check-circle', color: 'text-green-500' },
  complete: { icon: 'pi pi-check-circle', color: 'text-green-500' },
  completed: { icon: 'pi pi-check-circle', color: 'text-green-500' },
  arrived: { icon: 'pi pi-map-marker', color: 'text-blue-500' },
  checked_in: { icon: 'pi pi-map-marker', color: 'text-blue-500' },
  pending: { icon: 'pi pi-clock', color: 'text-yellow-500' },
  cancelled: { icon: 'pi pi-times-circle', color: 'text-red-500' },
  declined: { icon: 'pi pi-times-circle', color: 'text-red-500' },
  invited: { icon: 'pi pi-envelope', color: 'text-purple-500' },
  draft: { icon: 'pi pi-file', color: 'text-surface-400' },
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function getStatusIcon(status: string): { icon: string; color: string } {
  const normalized = status.toLowerCase().trim()
  return STATUS_ICON_MAP[normalized] ?? { icon: 'pi pi-circle-fill', color: 'text-primary-400' }
}

const CONCEPT_ROUTES: Record<string, string> = {
  ...CONCEPT_LIST_ROUTES,
  accommodation: '/accommodations',
}

function handleWidgetClick(): void {
  if (!props.widget.conceptKey) return
  const route = CONCEPT_ROUTES[props.widget.conceptKey] ?? '/dashboard'
  if (props.widget.filter) {
    const query: Record<string, string> = {}
    for (const [k, v] of Object.entries(props.widget.filter)) {
      if (v !== null && v !== undefined) {
        query[`filter[${k}]`] = Array.isArray(v) ? v.join(',') : String(v)
      }
    }
    router.push({ path: route, query })
  } else {
    router.push(route)
  }
}

async function loadData(): Promise<void> {
  // Activity feed loads recent records from multiple concepts
  if (props.widget.type === 'activity_feed') {
    loading.value = true
    try {
      const conceptKeys = ['guest', 'staff', 'transport', 'prep_item', 'schedule']
      const CONCEPT_LABELS: Record<string, string> = {
        guest: 'Guest',
        staff: 'Staff',
        transport: 'Transport',
        prep_item: 'Prep Item',
        schedule: 'Schedule',
        venue: 'Venue',
        pairing: 'Pairing',
        accommodation: 'Accommodation',
      }

      const fetches = conceptKeys.map(async (conceptKey) => {
        try {
          const data = await api.get<unknown>(`/api/domains/${conceptKey}?limit=5&sort=updated_at&direction=desc`)
          const items = Array.isArray(data)
            ? data
            : ((data as Record<string, unknown>).records as Record<string, unknown>[] ?? [])
          return items.map((r) => ({
            ...r,
            __conceptKey: conceptKey,
            __conceptLabel: CONCEPT_LABELS[conceptKey] ?? conceptKey,
          }))
        } catch {
          return []
        }
      })

      const results = await Promise.all(fetches)
      const allItems = results
        .flat()
        .sort((a, b) => {
          const dateA = new Date((a.updatedAt ?? a.updated_at ?? '1970-01-01') as string).getTime()
          const dateB = new Date((b.updatedAt ?? b.updated_at ?? '1970-01-01') as string).getTime()
          return dateB - dateA
        })

      activityItems.value = allItems.slice(0, 8).map((r) => {
        const p = (r.properties ?? {}) as Record<string, unknown>
        const name = (p.name ?? r.name ?? 'Record') as string
        const status = (p.status ?? r.status ?? '') as string
        const conceptLabel = (r.__conceptLabel ?? '') as string
        const conceptKey = (r.__conceptKey ?? '') as string
        const role = (p.role_key ?? p.role ?? r.role_key ?? r.role ?? '') as string

        // Staff records don't have status — show role instead of "updated to"
        let statusDisplay: string
        if (status) {
          statusDisplay = `updated to ${titleCase(status)}`
        } else if (conceptKey === 'staff' && role) {
          statusDisplay = `\u2014 ${titleCase(role)}`
        } else {
          statusDisplay = ''
        }

        const iconInfo = getStatusIcon(status)
        const summary = conceptLabel
          ? `${conceptLabel}: ${name}${statusDisplay ? ` ${statusDisplay}` : ''}`
          : `${name}${statusDisplay ? ` ${statusDisplay}` : ''}`
        return {
          id: r.id as string,
          summary,
          timeAgo: formatTimeAgo((r.updatedAt ?? r.updated_at ?? new Date().toISOString()) as string),
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
        }
      })
    } catch {
      activityItems.value = []
    } finally {
      loading.value = false
    }
    return
  }

  if (!props.widget.conceptKey) {
    loading.value = false
    return
  }

  loading.value = true
  try {
    const params = new URLSearchParams()
    if (props.widget.filter) {
      for (const [k, v] of Object.entries(props.widget.filter)) {
        if (v !== null && v !== undefined) {
          params.set(`filter[${k}]`, Array.isArray(v) ? v.join(',') : String(v))
        }
      }
    }

    // When time scope is "today", filter to records updated today or later
    if (props.timeScope === 'today') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      params.set('filter.updated_at_gte', todayStart.toISOString())
    } else if (props.timeScope === 'week') {
      // Calculate start of the current week (Monday)
      const now = new Date()
      const day = now.getDay()
      const diffToMonday = day === 0 ? 6 : day - 1 // Sunday = 6 days back, else day-1
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - diffToMonday)
      weekStart.setHours(0, 0, 0, 0)
      params.set('filter.updated_at_gte', weekStart.toISOString())
    }

    const qs = params.toString()
    const path = `/api/domains/${props.widget.conceptKey}${qs ? `?${qs}` : ''}`
    const data = await api.get<Record<string, unknown>>(path)

    // Handle both response formats:
    // Real backend: data is array (ApiResponse.data unwrapped by client), meta.total in separate field
    // Shim: data is { records: [...], total: N }
    const dataObj = data as Record<string, unknown>
    // Use __meta.total from API response when available for accurate counts
    const metaTotal = (dataObj as Record<string, unknown>).__meta
      ? ((dataObj as Record<string, unknown>).__meta as Record<string, unknown>).total as number | undefined
      : undefined

    if (Array.isArray(data)) {
      records.value = data as Record<string, unknown>[]
      count.value = metaTotal ?? records.value.length
    } else if (dataObj.records) {
      records.value = dataObj.records as Record<string, unknown>[]
      count.value = (dataObj.total as number) ?? records.value.length
    } else {
      records.value = []
      count.value = 0
    }

    // Calculate progress for prep_progress type
    if (props.widget.type === 'prep_progress' && records.value.length > 0) {
      const complete = records.value.filter((r) => {
        const p = (r.properties ?? {}) as Record<string, unknown>
        const status = ((p.status ?? r.status ?? '') as string).toLowerCase()
        return status === 'complete' || status === 'completed'
      }).length
      progressPct.value = Math.round((complete / records.value.length) * 100)
    }
  } catch {
    count.value = 0
    records.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()

  // Auto-refresh activity feed every 60 seconds
  if (props.widget.type === 'activity_feed') {
    const interval = setInterval(loadData, 60_000)
    onUnmounted(() => clearInterval(interval))
  }
})
watch(() => props.refreshKey, loadData)
watch(() => props.timeScope, loadData)
</script>
