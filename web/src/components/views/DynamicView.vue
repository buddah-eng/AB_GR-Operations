<template>
  <div class="dv-root">
    <!-- Header with title and preset selector -->
    <div class="dv-header">
      <div class="dv-header-text">
        <h2 v-if="config.title" class="dv-title">{{ config.title }}</h2>
        <p v-if="config.description" class="dv-description">
          {{ config.description }}
        </p>
      </div>

      <div class="dv-header-actions">
        <ViewPresets
          v-if="presets.length > 0"
          :presets="presets"
          :active-preset-id="config.activePresetId"
          @select="handlePresetSelect"
          @save="handlePresetSave"
        />
      </div>
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="loading"
      class="dv-skeleton"
      aria-busy="true"
      aria-label="Loading view data"
    >
      <div class="skeleton dv-skeleton-header" />
      <div class="skeleton dv-skeleton-row" v-for="n in 5" :key="n" />
    </div>

    <!-- Error state -->
    <div v-else-if="errorMessage" class="dv-error" role="alert">
      <i class="pi pi-exclamation-triangle dv-error-icon" aria-hidden="true" />
      <p class="dv-error-text">{{ errorMessage }}</p>
    </div>

    <!-- View dispatcher -->
    <template v-else>
      <ViewCardRows
        v-if="config.viewType === 'table' && config.renderMode !== 'dense-table'"
        :config="config"
        :data="data"
        :total-records="totalRecords"
        @sort="(s) => emit('sort', s)"
        @filter="(f) => emit('filter', f as ViewFilter)"
        @page="(e) => emit('page', e)"
        @row-click="(r) => emit('row-click', r)"
      />

      <ViewTable
        v-else-if="config.viewType === 'table' && config.renderMode === 'dense-table'"
        :config="config"
        :data="data"
        :total-records="totalRecords"
        @sort="(s) => emit('sort', s)"
        @filter="(f) => emit('filter', f as ViewFilter)"
        @page="(e) => emit('page', e)"
        @row-click="(r) => emit('row-click', r)"
      />

      <ViewKanban
        v-else-if="config.viewType === 'kanban'"
        :config="config"
        :data="data"
        @card-click="(r) => emit('row-click', r)"
        @card-move="(e) => emit('card-move', e)"
      />

      <ViewTimeline
        v-else-if="config.viewType === 'timeline'"
        :config="config"
        :data="data"
        @event-click="(r) => emit('row-click', r)"
      />

      <ViewDetail
        v-else-if="config.viewType === 'detail'"
        :config="config"
        :data="data[0] ?? null"
      />

      <ViewDashboard
        v-else-if="config.viewType === 'dashboard'"
        :config="config"
        :data="data"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { ViewConfig, ViewPreset, ViewSort, ViewFilter } from '@/types/views'
import ViewTable from './ViewTable.vue'
import ViewCardRows from './ViewCardRows.vue'
import ViewKanban from './ViewKanban.vue'
import ViewTimeline from './ViewTimeline.vue'
import ViewDetail from './ViewDetail.vue'
import ViewDashboard from './ViewDashboard.vue'
import ViewPresets from './ViewPresets.vue'

interface Props {
  config: ViewConfig
  data: Record<string, unknown>[]
  totalRecords?: number
  loading?: boolean
  error?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  totalRecords: 0,
  loading: false,
  error: null,
})

const emit = defineEmits<{
  sort: [sort: ViewSort]
  filter: [filter: ViewFilter]
  page: [event: { page: number; rows: number }]
  'row-click': [record: Record<string, unknown>]
  'card-move': [event: { recordId: string; fromGroup: string; toGroup: string }]
  'preset-select': [preset: ViewPreset]
  'preset-save': [preset: Omit<ViewPreset, 'id'>]
}>()

const errorMessage = computed(() => props.error)

const presets = computed(() => props.config.presets ?? [])

function handlePresetSelect(_preset: ViewPreset): void {
  // Delegate up — parent manages config changes
}

function handlePresetSave(_preset: Omit<ViewPreset, 'id'>): void {
  // Delegate up — parent manages persistence
}
</script>

<style scoped>
.dv-root {
}

/* Header */
.dv-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-6);
  gap: var(--space-4);
}

.dv-header-text {
  min-width: 0;
}

.dv-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--weight-bold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-display);
  margin: 0;
}

.dv-description {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: var(--space-1) 0 0;
  line-height: var(--leading-relaxed);
}

.dv-header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* Skeleton loading */
.dv-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.dv-skeleton-header {
  width: 100%;
  height: 3rem;
}

.dv-skeleton-row {
  width: 100%;
  height: 2.5rem;
}

/* Error */
.dv-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-error-bg);
  border: var(--border-thin) solid var(--color-error-bg-border);
  border-radius: var(--radius-lg);
}

.dv-error-icon {
  color: var(--color-error);
  font-size: var(--text-lg);
  flex-shrink: 0;
  margin-top: 2px;
}

.dv-error-text {
  color: var(--color-error-text);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  margin: 0;
}
</style>
