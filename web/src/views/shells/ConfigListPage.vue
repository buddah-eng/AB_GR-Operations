<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
        {{ pageTitle }}
      </h1>
      <Button
        v-if="canCreate"
        label="New"
        icon="pi pi-plus"
        @click="navigateToForm"
      />
    </div>

    <DynamicView
      v-if="viewConfig"
      :config="viewConfig"
      :data="records"
      :total-records="total"
      :loading="dataLoading"
      :error="viewError ?? dataError"
      @sort="handleSort"
      @filter="handleFilter"
      @page="handlePage"
      @row-click="handleRowClick"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import DynamicView from '@/components/views/DynamicView.vue'
import { useViewConfig } from '@/composables/useViewConfig'
import { useConceptData } from '@/composables/useConceptData'
import { useOntologyStore } from '@/stores/ontology'
import type { ViewSort, ViewFilter } from '@/types/views'

const route = useRoute()
const router = useRouter()
const ontologyStore = useOntologyStore()

const conceptKey = computed(() => (route.meta.conceptKey as string) ?? '')
const viewName = computed(() => (route.meta.viewName as string) ?? 'default-list')

const { config: viewConfig, loading: _configLoading, error: viewError } = useViewConfig(conceptKey, viewName)
const { records, loading: dataLoading, error: dataError, total, reload } = useConceptData(conceptKey)

const concept = computed(() => ontologyStore.getConceptByKey(conceptKey.value))
const pageTitle = computed(() => {
  const c = concept.value
  if (c) return c.pluralLabel ?? c.label ?? conceptKey.value
  // Humanize concept key: schedule_event → Schedule Events, staff → Staff
  const humanized = conceptKey.value.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
  // Don't add 's' if already ends in 's' or is a mass noun
  if (humanized.endsWith('s') || humanized.endsWith('ff') || humanized.toLowerCase() === 'staff' || humanized.toLowerCase() === 'dietary') return humanized
  return humanized + 's'
})
const canCreate = computed(() => !!concept.value)

function navigateToForm(): void {
  router.push({ name: 'new-guest', params: {} })
}

function handleSort(_sort: ViewSort): void {
  reload()
}

function handleFilter(_filter: ViewFilter): void {
  reload()
}

function handlePage(_event: { page: number; rows: number }): void {
  reload()
}

function handleRowClick(record: Record<string, unknown>): void {
  const id = record.id as string
  if (id && viewConfig.value?.rowAction === 'navigate_to_detail') {
    router.push(`/${conceptKey.value}s/${id}`)
  }
}
</script>
