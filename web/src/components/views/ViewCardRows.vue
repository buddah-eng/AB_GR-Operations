<template>
  <div class="vcr-root">
    <!-- Loading skeleton -->
    <div
      v-if="loading"
      class="vcr-skeleton"
      aria-busy="true"
      aria-label="Loading records"
    >
      <div v-for="n in pageSize" :key="n" class="vcr-skeleton-card">
        <div class="vcr-skeleton-left">
          <div class="skeleton vcr-skeleton-title" />
          <div class="skeleton vcr-skeleton-field" />
          <div class="skeleton vcr-skeleton-field vcr-skeleton-field--short" />
        </div>
        <div class="vcr-skeleton-right">
          <div class="skeleton vcr-skeleton-badge" />
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="data.length === 0"
      class="vcr-empty"
      role="status"
    >
      <i class="pi pi-list vcr-empty-icon" aria-hidden="true" />
      <h3 class="vcr-empty-heading">No records found</h3>
      <p class="vcr-empty-text">
        Try adjusting your filters or create a new record to get started.
      </p>
    </div>

    <!-- Card rows -->
    <div v-else class="vcr-list">
      <div
        v-for="record in data"
        :key="getRecordId(record)"
        class="vcr-card"
        role="button"
        tabindex="0"
        :aria-label="getPrimaryValue(record)"
        @click="handleRowClick(record)"
        @keydown.enter="handleRowClick(record)"
      >
        <!-- Card top row: primary field + badges -->
        <div class="vcr-card-header">
          <div class="vcr-card-primary-group">
            <i
              v-if="primaryColumn?.renderer === 'relation-link'"
              class="pi pi-link vcr-card-icon"
              aria-hidden="true"
            />
            <i
              v-else
              class="pi pi-file vcr-card-icon"
              aria-hidden="true"
            />
            <span class="vcr-card-primary">{{ getPrimaryValue(record) }}</span>
          </div>

          <div class="vcr-card-badges">
            <Tag
              v-for="badge in getBadgeColumns(record)"
              :key="badge.key"
              :value="badge.value"
              :severity="badge.severity"
              class="vcr-badge"
            />
          </div>
        </div>

        <!-- Card body: secondary fields grid -->
        <div v-if="secondaryFields.length > 0" class="vcr-card-body">
          <div
            v-for="col in secondaryFields"
            :key="getColumnKey(col)"
            class="vcr-field"
          >
            <span class="vcr-field-label">{{ col.label }}</span>

            <!-- Progress bar renderer -->
            <ProgressBar
              v-if="col.renderer === 'progress-bar'"
              :value="toNumber(resolveColumnValue(record, col))"
              :showValue="true"
              class="vcr-progress"
            />

            <!-- Relative date renderer -->
            <span
              v-else-if="col.renderer === 'relative-date'"
              class="vcr-field-value"
            >
              {{ formatRelativeDate(resolveColumnValue(record, col)) }}
            </span>

            <!-- Relation link renderer -->
            <span
              v-else-if="col.renderer === 'relation-link'"
              class="vcr-field-value vcr-field-value--link"
              @click.stop="handleRelationClick(record, col)"
            >
              {{ formatCellValue(resolveColumnValue(record, col), col) }}
            </span>

            <!-- Default renderer -->
            <span v-else class="vcr-field-value">
              {{ formatCellValue(resolveColumnValue(record, col), col) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <Paginator
        v-if="totalRecords > pageSize"
        :rows="pageSize"
        :totalRecords="totalRecords"
        :first="first"
        @page="handlePage"
        class="vcr-paginator"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import Paginator from 'primevue/paginator'

import type { ViewConfig, ViewColumn, ViewSort } from '@/types/views'

/* ------------------------------------------------------------------ */
/*  Props & Emits — identical interface to ViewTable                  */
/* ------------------------------------------------------------------ */

interface Props {
  config: ViewConfig
  data: Record<string, unknown>[]
  totalRecords?: number
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  totalRecords: 0,
  loading: false,
})

const emit = defineEmits<{
  sort: [sort: ViewSort]
  filter: [filter: { field: string; value: unknown }]
  page: [event: { page: number; rows: number }]
  'row-click': [record: Record<string, unknown>]
}>()

/* ------------------------------------------------------------------ */
/*  Pagination state                                                   */
/* ------------------------------------------------------------------ */

const first = ref(0)

const pageSize = computed(() => props.config.pageSize ?? 25)

/* ------------------------------------------------------------------ */
/*  Column classification                                              */
/* ------------------------------------------------------------------ */

const visibleColumns = computed<ViewColumn[]>(() => {
  const columns = props.config.columns ?? []
  return columns.filter((col) => col.visible !== false)
})

/** The first visible column serves as the primary (headline) field */
const primaryColumn = computed<ViewColumn | null>(() =>
  visibleColumns.value.length > 0 ? visibleColumns.value[0] : null,
)

/** Columns that render as colored badges (status/type/role) */
const badgeColumnKeys = computed<Set<string>>(() => {
  const keys = new Set<string>()
  for (const col of visibleColumns.value) {
    const key = getColumnKey(col)
    const isBadgeRenderer =
      col.renderer === 'status-badge' || col.renderer === 'role-badge'
    const isBadgeName =
      key === 'status' || key === 'type' || key === 'role'
    if (isBadgeRenderer || isBadgeName) {
      keys.add(key)
    }
  }
  return keys
})

/** Columns displayed in the secondary grid (everything except primary and badges) */
const secondaryFields = computed<ViewColumn[]>(() => {
  const primary = primaryColumn.value
  return visibleColumns.value.filter((col) => {
    const key = getColumnKey(col)
    if (primary && key === getColumnKey(primary)) return false
    if (badgeColumnKeys.value.has(key)) return false
    return true
  })
})

/* ------------------------------------------------------------------ */
/*  Value resolution                                                   */
/* ------------------------------------------------------------------ */

function getColumnKey(col: ViewColumn): string {
  return col.key ?? col.propertyKey ?? ''
}

/**
 * Resolves the display value from a record for a given column.
 * Falls back through: record[key] -> record[propertyKey] -> record.properties[key]
 */
function resolveColumnValue(
  record: Record<string, unknown>,
  column: ViewColumn,
): unknown {
  const key = column.key
  const propertyKey = column.propertyKey

  if (key && record[key] !== undefined) {
    return record[key]
  }
  if (propertyKey && record[propertyKey] !== undefined) {
    return record[propertyKey]
  }

  const properties = record.properties as Record<string, unknown> | undefined
  if (properties) {
    if (key && properties[key] !== undefined) {
      return properties[key]
    }
    if (propertyKey && properties[propertyKey] !== undefined) {
      return properties[propertyKey]
    }
  }

  return undefined
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function formatCellValue(value: unknown, column: ViewColumn): string {
  if (value === null || value === undefined) return '\u2014'

  const colType = column.type ?? 'text'
  const strValue = String(value)

  switch (colType) {
    case 'date':
      try {
        return new Date(strValue).toLocaleDateString()
      } catch {
        return strValue
      }
    case 'datetime':
      try {
        return new Date(strValue).toLocaleString()
      } catch {
        return strValue
      }
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'currency':
      return typeof value === 'number'
        ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        : strValue
    case 'percentage':
      return typeof value === 'number' ? `${value}%` : strValue
    default:
      return strValue
  }
}

function formatRelativeDate(value: unknown): string {
  if (value === null || value === undefined) return '\u2014'

  const date = new Date(String(value))
  if (isNaN(date.getTime())) return String(value)

  const now = Date.now()
  const diffMs = now - date.getTime()
  const absDiffMs = Math.abs(diffMs)
  const isFuture = diffMs < 0

  const seconds = Math.floor(absDiffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  const suffix = isFuture ? 'from now' : 'ago'

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ${suffix}`
  if (hours < 24) return `${hours}h ${suffix}`
  if (days < 7) return `${days}d ${suffix}`
  if (weeks < 5) return `${weeks}w ${suffix}`
  if (months < 12) return `${months}mo ${suffix}`
  return `${years}y ${suffix}`
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return isNaN(parsed) ? 0 : parsed
}

/* ------------------------------------------------------------------ */
/*  Badge severity mapping                                             */
/* ------------------------------------------------------------------ */

interface BadgeInfo {
  key: string
  value: string
  severity: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined
}

const STATUS_SEVERITY_MAP: Record<string, BadgeInfo['severity']> = {
  active: 'success',
  completed: 'success',
  done: 'success',
  approved: 'success',
  published: 'success',
  open: 'success',
  enabled: 'success',
  pending: 'warn',
  'in progress': 'warn',
  'in-progress': 'warn',
  review: 'warn',
  draft: 'warn',
  warning: 'warn',
  inactive: 'secondary',
  closed: 'secondary',
  archived: 'secondary',
  disabled: 'secondary',
  cancelled: 'secondary',
  paused: 'secondary',
  error: 'danger',
  failed: 'danger',
  rejected: 'danger',
  blocked: 'danger',
  overdue: 'danger',
  critical: 'danger',
  new: 'info',
  info: 'info',
  scheduled: 'info',
  assigned: 'info',
  admin: 'contrast',
  owner: 'contrast',
  manager: 'contrast',
  lead: 'contrast',
}

function resolveSeverity(value: string): BadgeInfo['severity'] {
  const normalized = value.toLowerCase().trim()
  return STATUS_SEVERITY_MAP[normalized] ?? 'info'
}

function getBadgeColumns(record: Record<string, unknown>): BadgeInfo[] {
  const badges: BadgeInfo[] = []

  for (const col of visibleColumns.value) {
    const key = getColumnKey(col)
    if (!badgeColumnKeys.value.has(key)) continue

    const raw = resolveColumnValue(record, col)
    if (raw === null || raw === undefined || raw === '') continue

    const value = String(raw)
    badges.push({
      key,
      value,
      severity: resolveSeverity(value),
    })
  }

  return badges
}

/* ------------------------------------------------------------------ */
/*  Record helpers                                                     */
/* ------------------------------------------------------------------ */

function getRecordId(record: Record<string, unknown>): string {
  return String(record.id ?? record.key ?? Math.random())
}

function getPrimaryValue(record: Record<string, unknown>): string {
  if (!primaryColumn.value) {
    return String(record.name ?? record.title ?? record.id ?? 'Untitled')
  }
  const value = resolveColumnValue(record, primaryColumn.value)
  return value !== null && value !== undefined ? String(value) : 'Untitled'
}

/* ------------------------------------------------------------------ */
/*  Event handlers                                                     */
/* ------------------------------------------------------------------ */

function handleRowClick(record: Record<string, unknown>): void {
  emit('row-click', record)
}

function handlePage(event: { page: number; rows: number; first: number }): void {
  first.value = event.first
  emit('page', { page: event.page, rows: event.rows })
}

function handleRelationClick(
  record: Record<string, unknown>,
  _column: ViewColumn,
): void {
  emit('row-click', record)
}
</script>

<style scoped>
.vcr-root {
}

/* ============================================================
   Skeleton loading
   ============================================================ */

.vcr-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.vcr-skeleton-card {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: var(--bg-card);
  border: var(--border-thin) solid var(--surface-100);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
}

.vcr-skeleton-left {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex: 1;
}

.vcr-skeleton-right {
  flex-shrink: 0;
  margin-left: var(--space-4);
}

.vcr-skeleton-title {
  width: 40%;
  height: 1.25rem;
}

.vcr-skeleton-field {
  width: 60%;
  height: 0.875rem;
}

.vcr-skeleton-field--short {
  width: 35%;
}

.vcr-skeleton-badge {
  width: 4.5rem;
  height: 1.5rem;
  border-radius: var(--radius-full);
}

/* ============================================================
   Empty state
   ============================================================ */

.vcr-empty {
  text-align: center;
  padding: var(--space-16) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.vcr-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-4);
}

.vcr-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.vcr-empty-text {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  max-width: 28rem;
  margin-left: auto;
  margin-right: auto;
  line-height: var(--leading-relaxed);
}

/* ============================================================
   Card list
   ============================================================ */

.vcr-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* ============================================================
   Individual card
   ============================================================ */

.vcr-card {
  background: var(--bg-card);
  border: var(--border-thin) solid var(--surface-200);
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-5);
  cursor: pointer;
  transition:
    box-shadow var(--duration-normal) var(--ease-default),
    border-color var(--duration-normal) var(--ease-default),
    transform var(--duration-fast) var(--ease-default);
  box-shadow: var(--shadow-xs);
}

.vcr-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--primary-300);
  transform: translateY(-1px);
}

.vcr-card:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.vcr-card:active {
  transform: scale(0.995);
  box-shadow: var(--shadow-sm);
}

/* ============================================================
   Card header — primary field + badges
   ============================================================ */

.vcr-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.vcr-card-primary-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.vcr-card-icon {
  font-size: var(--text-base);
  color: var(--text-muted);
  flex-shrink: 0;
}

.vcr-card-primary {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-snug);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vcr-card-badges {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.vcr-badge {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: capitalize;
}

/* ============================================================
   Card body — secondary fields grid
   ============================================================ */

.vcr-card-body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: var(--space-2) var(--space-6);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--border-thin) solid var(--surface-100);
}

.vcr-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.vcr-field-label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
}

.vcr-field-value {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-normal);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vcr-field-value--link {
  color: var(--primary-600);
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color var(--duration-fast) var(--ease-default);
}

.vcr-field-value--link:hover {
  text-decoration-color: var(--primary-400);
}

/* ============================================================
   Progress bar within card
   ============================================================ */

.vcr-progress {
  height: 0.5rem;
  border-radius: var(--radius-full);
  margin-top: var(--space-1);
}

.vcr-progress :deep(.p-progressbar-value) {
  border-radius: var(--radius-full);
}

/* ============================================================
   Paginator
   ============================================================ */

.vcr-paginator {
  margin-top: var(--space-4);
  border: var(--border-thin) solid var(--surface-200);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  background: var(--bg-card);
}
</style>
