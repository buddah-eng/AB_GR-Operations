<template>
  <div class="rounded-lg border border-surface-200 bg-surface-0 p-4 shadow-sm">
    <h3 class="text-sm font-medium text-surface-500 mb-2">{{ widget.title }}</h3>

    <!-- Stat card -->
    <div v-if="widget.type === 'stat_card'" class="text-3xl font-bold text-surface-900">
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
        <span class="text-surface-700">{{ rec.name ?? rec.id }}</span>
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
    <div v-else-if="widget.type === 'activity_feed'" class="text-sm text-surface-400">
      Recent activity
    </div>

    <!-- Fallback -->
    <div v-else class="text-sm text-surface-400">
      Widget: {{ widget.type }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import ProgressBar from 'primevue/progressbar'
import { api } from '@/api/client'
import type { PageWidget } from '@/composables/usePageConfig'

const props = defineProps<{
  widget: PageWidget
  refreshKey?: number
}>()

const count = ref(0)
const records = ref<Record<string, unknown>[]>([])
const loading = ref(true)
const progressPct = ref(0)

async function loadData(): Promise<void> {
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
          params.set(`filter.${k}`, Array.isArray(v) ? v.join(',') : String(v))
        }
      }
    }

    const qs = params.toString()
    const path = `/api/domains/${props.widget.conceptKey}${qs ? `?${qs}` : ''}`
    const data = await api.get<Record<string, unknown>>(path)

    const rawRecords = (data as Record<string, unknown>).records as Record<string, unknown>[] | undefined
    records.value = rawRecords ?? (Array.isArray(data) ? data : [])
    count.value = (data as Record<string, unknown>).total as number ?? records.value.length

    // Calculate progress for prep_progress type
    if (props.widget.type === 'prep_progress' && records.value.length > 0) {
      const complete = records.value.filter(
        (r) => r.status === 'complete' || r.status === 'completed'
      ).length
      progressPct.value = Math.round((complete / records.value.length) * 100)
    }
  } catch {
    count.value = 0
    records.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
watch(() => props.refreshKey, loadData)
</script>
