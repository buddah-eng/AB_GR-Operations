<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
        {{ pageTitle }}
      </h1>
      <div class="flex items-center gap-2">
        <Button
          v-if="canCreate"
          label="New"
          icon="pi pi-plus"
          @click="navigateToForm"
        />
        <Button
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="Customize view"
          @click="router.push({ name: 'view-builder', params: { conceptKey: conceptKey } })"
        />
      </div>
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
      @card-move="handleCardMove"
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
import { api } from '@/api/client'
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
  const humanized = conceptKey.value.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
  if (humanized.endsWith('s') || humanized.endsWith('ff') || humanized.toLowerCase() === 'staff' || humanized.toLowerCase() === 'dietary') return humanized
  return humanized + 's'
})
const canCreate = computed(() => !!concept.value)

function navigateToForm(): void {
  // Concept-aware: navigate to the create form for THIS concept, not hardcoded to guest
  const formRoutes: Record<string, string> = {
    guest: 'new-guest',
  }
  const routeName = formRoutes[conceptKey.value]
  if (routeName) {
    router.push({ name: routeName })
  } else {
    // Generic: navigate to /:conceptKey/new if route exists
    router.push(`/${conceptKey.value}s/new`)
  }
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
  if (!id) return

  // Concept-aware routing: map concept keys to named detail routes
  const detailRoutes: Record<string, string> = {
    guest: 'guest-detail',
    staff: 'staff-detail',
    schedule_event: 'schedule-detail',
    prep_item: 'prep-detail',
  }
  const routeName = detailRoutes[conceptKey.value]
  if (routeName) {
    router.push({ name: routeName, params: { id } })
  }
  // If no detail route exists for this concept, do nothing (don't navigate to 404)
}

async function handleCardMove(event: { recordId: string; fromGroup: string; toGroup: string }): Promise<void> {
  // Update the record's group field (usually 'status') via PUT
  const groupField = viewConfig.value?.groupBy ?? 'status'
  try {
    await api.put(`/api/domains/${conceptKey.value}/${event.recordId}`, {
      [groupField]: event.toGroup,
    })
    reload()
  } catch (err) {
    console.error('Failed to update record:', err)
    reload() // Reload to revert visual state
  }
}
</script>
