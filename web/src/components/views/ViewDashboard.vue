<template>
  <div class="vdb-root" role="region" aria-label="Dashboard">
    <!-- Loading skeleton -->
    <div v-if="loading" class="vdb-skeleton" aria-busy="true">
      <div class="skeleton vdb-skeleton-stat" v-for="n in 4" :key="n" />
      <div class="skeleton vdb-skeleton-chart" />
      <div class="skeleton vdb-skeleton-chart" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="widgets.length === 0"
      class="vdb-empty"
      role="status"
    >
      <i class="pi pi-th-large vdb-empty-icon" aria-hidden="true" />
      <h3 class="vdb-empty-heading">No widgets configured</h3>
      <p class="vdb-empty-text">
        Contact your administrator to set up dashboard widgets.
      </p>
    </div>

    <!-- Widget grid -->
    <div v-else class="vdb-grid">
      <div
        v-for="widget in widgets"
        :key="widget.id"
        :class="['vdb-widget', widgetSpanClass(widget)]"
      >
        <!-- Stat card widget -->
        <div
          v-if="widget.type === 'stat-card'"
          class="vdb-card vdb-card--stat"
          role="status"
          :aria-label="widget.title"
        >
          <div class="vdb-card-label">{{ widget.title }}</div>
          <div class="vdb-stat-value">{{ getStatValue(widget) }}</div>
          <div v-if="getStatSubtitle(widget)" class="vdb-stat-subtitle">
            {{ getStatSubtitle(widget) }}
          </div>
        </div>

        <!-- Chart widget (placeholder) -->
        <div
          v-else-if="widget.type === 'chart'"
          class="vdb-card"
          :aria-label="widget.title"
        >
          <div class="vdb-card-title">{{ widget.title }}</div>
          <div class="vdb-chart-placeholder">
            <i class="pi pi-chart-bar vdb-chart-icon" aria-hidden="true" />
            <p class="vdb-chart-label">Chart visualization</p>
          </div>
        </div>

        <!-- Table widget -->
        <div
          v-else-if="widget.type === 'table'"
          class="vdb-card"
          :aria-label="widget.title"
        >
          <div class="vdb-card-title">{{ widget.title }}</div>
          <div
            v-if="getWidgetData(widget).length === 0"
            class="vdb-widget-empty"
          >
            No data available
          </div>
          <table v-else class="vdb-table" role="table">
            <tbody>
              <tr
                v-for="(row, idx) in getWidgetData(widget).slice(0, 5)"
                :key="idx"
                class="vdb-table-row"
              >
                <td class="vdb-table-cell vdb-table-cell--label">{{ getRowLabel(row) }}</td>
                <td class="vdb-table-cell vdb-table-cell--value">{{ getRowValue(row) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- List widget -->
        <div
          v-else-if="widget.type === 'list'"
          class="vdb-card"
          :aria-label="widget.title"
        >
          <div class="vdb-card-title">{{ widget.title }}</div>
          <div
            v-if="getWidgetData(widget).length === 0"
            class="vdb-widget-empty"
          >
            No items to display
          </div>
          <ul v-else class="vdb-list" role="list">
            <li
              v-for="(item, idx) in getWidgetData(widget).slice(0, 8)"
              :key="idx"
              class="vdb-list-item"
            >
              <span class="vdb-list-dot" aria-hidden="true" />
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
    2: 'vdb-widget-span-2',
    3: 'vdb-widget-span-3',
    4: 'vdb-widget-span-4',
  }

  const rowClasses: Record<number, string> = {
    1: '',
    2: 'vdb-widget-row-2',
    3: 'vdb-widget-row-3',
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

<style scoped>
.vdb-root {
}

/* Skeleton */
.vdb-skeleton {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.vdb-skeleton-stat {
  height: 6rem;
  border-radius: var(--radius-lg);
}

.vdb-skeleton-chart {
  height: 12rem;
  grid-column: span 2;
  border-radius: var(--radius-lg);
}

@media (max-width: 1023px) {
  .vdb-skeleton {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 767px) {
  .vdb-skeleton {
    grid-template-columns: 1fr;
  }
  .vdb-skeleton-chart {
    grid-column: span 1;
  }
}

/* Empty state */
.vdb-empty {
  text-align: center;
  padding: var(--space-16) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.vdb-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-4);
}

.vdb-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.vdb-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: var(--leading-relaxed);
}

/* Widget grid */
.vdb-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

@media (max-width: 1023px) {
  .vdb-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 767px) {
  .vdb-grid {
    grid-template-columns: 1fr;
  }
}

/* Widget span classes */
.vdb-widget-span-2 {
  grid-column: span 2;
}

.vdb-widget-span-3 {
  grid-column: span 3;
}

.vdb-widget-span-4 {
  grid-column: span 4;
}

.vdb-widget-row-2 {
  grid-row: span 2;
}

.vdb-widget-row-3 {
  grid-row: span 3;
}

@media (max-width: 767px) {
  .vdb-widget-span-2,
  .vdb-widget-span-3,
  .vdb-widget-span-4 {
    grid-column: span 1;
  }
}

/* Card base */
.vdb-card {
  background: var(--bg-card);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  box-shadow: var(--shadow-xs);
  border: var(--border-thin) solid var(--surface-100);
  transition: all var(--duration-normal) var(--ease-default);
}

.vdb-card:hover {
  box-shadow: var(--shadow-md);
  border-left: var(--border-thick) solid var(--accent-400);
}

.vdb-card-label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  margin-bottom: var(--space-2);
}

.vdb-card-title {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-3);
  letter-spacing: var(--tracking-wide);
}

/* Stat card */
.vdb-stat-value {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-black);
  color: var(--text-primary);
  line-height: var(--leading-tight);
}

.vdb-stat-subtitle {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-1);
}

/* Chart placeholder */
.vdb-chart-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 8rem;
  color: var(--text-muted);
}

.vdb-chart-icon {
  font-size: var(--text-3xl);
  opacity: 0.3;
  margin-bottom: var(--space-2);
}

.vdb-chart-label {
  font-size: var(--text-xs);
  margin: 0;
}

/* Table widget */
.vdb-table {
  width: 100%;
  font-size: var(--text-xs);
  border-collapse: collapse;
}

.vdb-table-row {
  border-bottom: var(--border-thin) solid var(--surface-100);
}

.vdb-table-row:last-child {
  border-bottom: none;
}

.vdb-table-cell {
  padding: var(--space-2) 0;
}

.vdb-table-cell--label {
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}

.vdb-table-cell--value {
  text-align: right;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* List widget */
.vdb-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.vdb-list-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.vdb-list-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--radius-full);
  background: var(--primary-500);
  flex-shrink: 0;
}

/* Widget empty */
.vdb-widget-empty {
  text-align: center;
  padding: var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
