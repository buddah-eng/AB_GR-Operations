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
          v-if="isDirectorOrAbove"
          icon="pi pi-file-edit"
          severity="secondary"
          text
          rounded
          aria-label="Customize form"
          @click="router.push({ name: 'form-builder', params: { conceptKey } })"
        />
        <Button
          v-if="isDirectorOrAbove"
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
import { useToast } from 'primevue/usetoast'
import DynamicView from '@/components/views/DynamicView.vue'
import { useViewConfig } from '@/composables/useViewConfig'
import { useConceptData } from '@/composables/useConceptData'
import { useOntologyStore } from '@/stores/ontology'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import { CONCEPT_DETAIL_ROUTES } from '@/utils/routes'
import type { ViewSort, ViewFilter } from '@/types/views'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const ontologyStore = useOntologyStore()
const authStore = useAuthStore()

const isDirectorOrAbove = computed(() =>
  ['director', 'admin', 'department_head'].includes(authStore.role as string ?? '')
)

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
  // Derive the create route from the current list route's path
  // e.g. /guests -> /guests/new, /staff -> /staff/new, /prep-tracker -> /prep-tracker/new
  const basePath = route.path.replace(/\/$/, '')
  router.push(`${basePath}/new`)
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

  // Concept-aware routing: use shared route map
  const routeName = CONCEPT_DETAIL_ROUTES[conceptKey.value]
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
    const message = err instanceof Error ? err.message : 'Failed to update record'
    toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
    reload() // Reload to revert visual state
  }
}
</script>
