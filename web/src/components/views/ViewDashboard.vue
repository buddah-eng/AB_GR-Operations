<template>
  <div
    class="view-dashboard"
    role="region"
    aria-label="Dashboard"
  >
    <!-- Loading state -->
    <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" aria-busy="true">
      <Skeleton v-for="n in 4" :key="n" width="100%" height="6rem" />
      <Skeleton width="100%" height="12rem" class="md:col-span-2" />
      <Skeleton width="100%" height="12rem" class="md:col-span-2" />
    </div>

    <!-- Empty state -->
    <Message
      v-else-if="widgets.length === 0"
      severity="info"
      :closable="false"
    >
      No widgets configured for this dashboard. Contact your administrator to
      set up dashboard widgets.
    </Message>

    <!-- Widget grid -->
    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      <div
        v-for="widget in widgets"
        :key="widget.id"
        :class="widgetSpanClass(widget)"
      >
        <!-- Stat card widget -->
        <div
          v-if="widget.type === 'stat-card'"
          class="bg-white rounded-xl p-5 shadow-sm border border-surface-100"
          role="status"
          :aria-label="widget.title"
        >
          <div class="text-xs font-medium text-surface-400 uppercase tracking-wide mb-2">
            {{ widget.title }}
          </div>
          <div class="text-2xl font-bold text-surface-800">
            {{ getStatValue(widget) }}
          </div>
          <div
            v-if="getStatSubtitle(widget)"
            class="text-xs text-surface-500 mt-1"
          >
            {{ getStatSubtitle(widget) }}
          </div>
        </div>

        <!-- Chart widget (placeholder) -->
        <div
          v-else-if="widget.type === 'chart'"
          class="bg-white rounded-xl p-5 shadow-sm border border-surface-100"
          :aria-label="widget.title"
        >
          <div class="text-sm font-semibold text-surface-700 mb-3">
            {{ widget.title }}
          </div>
          <div class="flex items-center justify-center h-32 text-surface-300">
            <div class="text-center">
              <i class="pi pi-chart-bar text-3xl mb-2" />
              <p class="text-xs">Chart visualization</p>
            </div>
          </div>
        </div>

        <!-- Table widget -->
        <div
          v-else-if="widget.type === 'table'"
          class="bg-white rounded-xl p-5 shadow-sm border border-surface-100"
          :aria-label="widget.title"
        >
          <div class="text-sm font-semibold text-surface-700 mb-3">
            {{ widget.title }}
          </div>
          <div
            v-if="getWidgetData(widget).length === 0"
            class="text-center py-4 text-xs text-surface-400"
          >
            No data available
          </div>
          <table v-else class="w-full text-xs" role="table">
            <tbody>
              <tr
                v-for="(row, idx) in getWidgetData(widget).slice(0, 5)"
                :key="idx"
                class="border-b border-surface-100 last:border-0"
              >
                <td class="py-2 text-surface-700">{{ getRowLabel(row) }}</td>
                <td class="py-2 text-right text-surface-500">{{ getRowValue(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- List widget -->
        <div
          v-else-if="widget.type === 'list'"
          class="bg-white rounded-xl p-5 shadow-sm border border-surface-100"
          :aria-label="widget.title"
        >
          <div class="text-sm font-semibold text-surface-700 mb-3">
            {{ widget.title }}
          </div>
          <div
            v-if="getWidgetData(widget).length === 0"
            class="text-center py-4 text-xs text-surface-400"
          >
            No items to display
          </div>
          <ul v-else class="space-y-2" role="list">
            <li
              v-for="(item, idx) in getWidgetData(widget).slice(0, 8)"
              :key="idx"
              class="flex items-center gap-2 text-sm text-surface-700"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              {{ getRowLabel(item) }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'

import type { ViewConfig, DashboardWidget } from '@/types/views'

interface Props {
  config: ViewConfig
  data: Record<string, unknown>[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
})

const widgets = computed(() => props.config.widgets ?? [])

function widgetSpanClass(widget: DashboardWidget): string {
  const col = widget.colSpan ?? 1
  const row = widget.rowSpan ?? 1

  const colClasses: Record<number, string> = {
    1: '',
    2: 'md:col-span-2',
    3: 'md:col-span-2 lg:col-span-3',
    4: 'md:col-span-2 lg:col-span-4',
  }

  const rowClasses: Record<number, string> = {
    1: '',
    2: 'row-span-2',
    3: 'row-span-3',
  }

  return [colClasses[col] ?? '', rowClasses[row] ?? ''].filter(Boolean).join(' ')
}

function getStatValue(widget: DashboardWidget): string {
  const value = widget.config?.value
  if (value !== null && value !== undefined) return String(value)

  // Try to compute from data
  if (widget.conceptKey) {
    const matching = props.data.filter(
      (d) => d._concept === widget.conceptKey || d.concept === widget.conceptKey,
    )
    return String(matching.length)
  }

  return String(props.data.length)
}

function getStatSubtitle(widget: DashboardWidget): string | null {
  const subtitle = widget.config?.subtitle
  return subtitle ? String(subtitle) : null
}

function getWidgetData(widget: DashboardWidget): Record<string, unknown>[] {
  if (widget.conceptKey) {
    return props.data.filter(
      (d) => d._concept === widget.conceptKey || d.concept === widget.conceptKey,
    )
  }
  return props.data
}

function getRowLabel(row: Record<string, unknown>): string {
  return String(row.name ?? row.label ?? row.title ?? row.id ?? '')
}

function getRowValue(row: Record<string, unknown>): string {
  return String(row.value ?? row.count ?? row.total ?? '')
}
</script>
