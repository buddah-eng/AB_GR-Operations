<template>
  <div class="dynamic-view">
    <!-- Header with title and preset selector -->
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 v-if="config.title" class="text-xl font-bold text-surface-800">
          {{ config.title }}
        </h2>
        <p
          v-if="config.description"
          class="text-sm text-surface-500 mt-0.5"
        >
          {{ config.description }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <ViewPresets
          v-if="presets.length > 0"
          :presets="presets"
          :active-preset-id="config.activePresetId"
          @select="handlePresetSelect"
          @save="handlePresetSave"
        />
      </div>
    </div>

    <!-- Loading state -->
    <div
      v-if="loading"
      class="space-y-3"
      aria-busy="true"
      aria-label="Loading view data"
    >
      <Skeleton width="100%" height="3rem" />
      <Skeleton v-for="n in 5" :key="n" width="100%" height="2.5rem" />
    </div>

    <!-- Error state -->
    <Message
      v-else-if="errorMessage"
      severity="error"
      :closable="false"
    >
      {{ errorMessage }}
    </Message>

    <!-- View dispatcher -->
    <template v-else>
      <ViewTable
        v-if="config.viewType === 'table'"
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
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'

import type { ViewConfig, ViewPreset, ViewSort, ViewFilter } from '@/types/views'
import ViewTable from './ViewTable.vue'
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
