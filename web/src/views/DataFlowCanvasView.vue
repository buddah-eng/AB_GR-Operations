<template>
  <div class="space-y-4">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <i class="pi pi-arrows-h text-xl text-primary-500" />
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          Data Flow Canvas
        </h1>
        <span class="text-sm text-surface-400">
          Visualize how data routes from source concepts to destinations
        </span>
      </div>
      <div class="flex items-center gap-2">
        <!-- Filters -->
        <Select
          v-model="sourceFilter"
          :options="sourceConceptOptions"
          option-label="label"
          option-value="value"
          placeholder="Source concept"
          show-clear
          class="w-48"
          @change="loadRoutes"
        />
        <ToggleButton
          v-model="highlightPii"
          on-label="PII"
          off-label="PII"
          on-icon="pi pi-lock"
          off-icon="pi pi-lock-open"
          size="small"
          aria-label="Highlight PII flows"
        />
        <ToggleButton
          v-model="showLiveData"
          on-label="Live"
          off-label="Live"
          on-icon="pi pi-bolt"
          off-icon="pi pi-bolt"
          size="small"
          :disabled="loading"
          aria-label="Show live data animation"
        />
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          severity="secondary"
          size="small"
          :loading="loading"
          @click="loadRoutes"
        />
      </div>
    </div>

    <!-- Error state -->
    <div
      v-if="errorMessage"
      class="rounded-lg border-l-4 border-red-400 bg-red-50 px-5 py-4"
    >
      <div class="flex items-center gap-2">
        <i class="pi pi-exclamation-circle text-red-500" />
        <span class="text-sm font-medium text-red-700">{{ errorMessage }}</span>
      </div>
      <button
        class="mt-2 text-xs text-red-600 underline hover:text-red-800"
        @click="loadRoutes"
      >
        Try again
      </button>
    </div>

    <!-- Loading state -->
    <div
      v-if="loading && flowNodes.length === 0"
      class="flex flex-col items-center justify-center py-20"
    >
      <ProgressSpinner
        style="width: 40px; height: 40px"
        stroke-width="4"
        aria-label="Loading data flows"
      />
      <span class="mt-3 text-sm text-surface-500">Loading data flows...</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="flowNodes.length === 0 && !loading && !errorMessage"
      class="flex flex-col items-center justify-center py-20"
    >
      <i class="pi pi-arrows-h text-4xl text-surface-300 mb-3" />
      <h2 class="text-lg font-semibold text-surface-600">No Data Routes</h2>
      <p class="text-sm text-surface-400 mt-1 max-w-md text-center">
        No data routes configured. Create a route by dragging from a source
        concept to a destination, or use the builder to define routes.
      </p>
    </div>

    <!-- Canvas -->
    <div
      v-else
      :class="[
        'rounded-xl border border-surface-200 overflow-hidden bg-surface-50',
        'h-[calc(100vh-200px)]',
      ]"
    >
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.85, x: 50, y: 80 }"
        fit-view-on-init
        class="w-full h-full"
        @node-click="handleNodeClick"
      >
        <Background />
        <Controls />
        <MiniMap />
      </VueFlow>
    </div>

    <!-- Detail panel -->
    <Sidebar
      v-model:visible="detailPanelVisible"
      position="right"
      :header="detailPanelTitle"
      class="w-96"
    >
      <div v-if="selectedDetail" class="space-y-4">
        <div>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-1">
            Type
          </div>
          <Tag :value="selectedDetail.type" rounded />
        </div>

        <!-- Route info -->
        <template v-if="selectedDetail.route">
          <div>
            <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-1">
              PII Filter Mode
            </div>
            <Tag
              :value="selectedDetail.route.piiFilterMode"
              :severity="piiSeverity(selectedDetail.route.piiFilterMode)"
              rounded
            />
          </div>
          <div>
            <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-2">
              Field Mappings
            </div>
            <div class="space-y-1">
              <div
                v-for="mapping in selectedDetail.route.fieldMappings"
                :key="`${mapping.sourceField}-${mapping.destField}`"
                class="flex items-center gap-2 text-xs text-surface-600"
              >
                <span class="font-medium">{{ mapping.sourceField }}</span>
                <i class="pi pi-arrow-right text-surface-300" />
                <span>{{ mapping.destField }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Concept fields -->
        <template v-if="selectedDetail.fields">
          <div>
            <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-2">
              Fields
            </div>
            <div class="space-y-1">
              <div
                v-for="field in selectedDetail.fields"
                :key="field.key"
                class="flex items-center gap-2 text-xs"
              >
                <i
                  v-if="field.isPii"
                  class="pi pi-lock text-red-400"
                  title="PII field"
                />
                <span :class="field.isPii ? 'text-red-600 font-medium' : 'text-surface-600'">
                  {{ field.label }}
                </span>
                <Tag :value="field.type" rounded class="!text-[9px] ml-auto" severity="secondary" />
              </div>
            </div>
          </div>
        </template>
      </div>
    </Sidebar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, markRaw, type Component } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import type { Node, Edge } from '@vue-flow/core'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Sidebar from 'primevue/sidebar'
import Select from 'primevue/select'
import ToggleButton from 'primevue/togglebutton'
import ProgressSpinner from 'primevue/progressspinner'

import { api } from '@/api/client'
import { useOntologyStore } from '@/stores/ontology'
import type { DataRoute, PiiFilterMode } from '@/types/data-flow'
import ConceptNode from '@/components/canvas/nodes/ConceptNode.vue'

/* ---- Store ---- */

const ontologyStore = useOntologyStore()

/* ---- State ---- */

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const sourceFilter = ref<string | null>(null)
const highlightPii = ref(false)
const showLiveData = ref(false)
const detailPanelVisible = ref(false)

const routes = ref<DataRoute[]>([])
const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])

/* ---- Node types ---- */

const nodeTypes = {
  sourceConcept: markRaw(ConceptNode as Component),
  destConcept: markRaw(ConceptNode as Component),
}

/* ---- Filter options ---- */

const sourceConceptOptions = computed(() => {
  const keys = new Set<string>()
  for (const r of routes.value) {
    keys.add(r.sourceConceptKey)
  }
  return [...keys].map((k) => {
    const concept = ontologyStore.getConceptByKey(k)
    return { label: concept?.label ?? k, value: k }
  })
})

/* ---- Detail panel ---- */

interface DetailInfo {
  type: string
  route?: DataRoute
  fields?: Array<{ key: string; label: string; type: string; isPii: boolean }>
}

const selectedDetail = ref<DetailInfo | null>(null)
const detailPanelTitle = computed(() => selectedDetail.value?.type ?? 'Details')

function piiSeverity(mode: PiiFilterMode): string {
  switch (mode) {
    case 'strip': return 'success'
    case 'hash': return 'warn'
    case 'pass': return 'danger'
    default: return 'secondary'
  }
}

/* ---- Build flow from routes ---- */

function buildFlow(): void {
  const filtered = sourceFilter.value
    ? routes.value.filter((r) => r.sourceConceptKey === sourceFilter.value)
    : routes.value

  if (filtered.length === 0) {
    flowNodes.value = []
    flowEdges.value = []
    return
  }

  const nodes: Node[] = []
  const edges: Edge[] = []
  const conceptPositions = new Map<string, { x: number; y: number }>()

  // Collect unique source and dest concepts
  const sources = new Set<string>()
  const dests = new Set<string>()
  for (const r of filtered) {
    sources.add(r.sourceConceptKey)
    dests.add(r.destConceptKey)
  }

  // Position sources on the left
  let yOffset = 0
  for (const key of sources) {
    const concept = ontologyStore.getConceptByKey(key)
    const pos = { x: 50, y: yOffset }
    conceptPositions.set(`src-${key}`, pos)

    nodes.push({
      id: `src-${key}`,
      type: 'sourceConcept',
      position: pos,
      data: {
        label: concept?.label ?? key,
        icon: concept?.icon ?? 'pi pi-database',
        propertyCount: concept?.properties.length ?? 0,
        departmentColor: '#3b82f6',
        sourceId: key,
        sourceTable: 'ontology_concepts',
        properties: {},
      },
    })
    yOffset += 160
  }

  // Position destinations on the right
  yOffset = 0
  for (const key of dests) {
    const concept = ontologyStore.getConceptByKey(key)
    const pos = { x: 700, y: yOffset }
    conceptPositions.set(`dest-${key}`, pos)

    nodes.push({
      id: `dest-${key}`,
      type: 'destConcept',
      position: pos,
      data: {
        label: concept?.label ?? key,
        icon: concept?.icon ?? 'pi pi-database',
        propertyCount: concept?.properties.length ?? 0,
        departmentColor: '#22c55e',
        sourceId: key,
        sourceTable: 'ontology_concepts',
        properties: {},
      },
    })
    yOffset += 160
  }

  // Create edges for each route
  for (const route of filtered) {
    const sourceId = `src-${route.sourceConceptKey}`
    const destId = `dest-${route.destConceptKey}`

    // Check if route has PII
    const hasPii = route.piiFilterMode !== 'pass'

    // Security badge color
    let edgeColor = '#9ca3af'
    if (hasPii) {
      switch (route.piiFilterMode) {
        case 'strip': edgeColor = '#22c55e'; break
        case 'hash': edgeColor = '#eab308'; break
        default: edgeColor = '#ef4444'; break
      }
    }

    // PII highlighting
    const isPiiHighlighted = highlightPii.value && route.piiFilterMode !== 'pass'

    edges.push({
      id: `route-${route.id}`,
      source: sourceId,
      target: destId,
      type: 'default',
      label: route.name,
      animated: showLiveData.value,
      style: {
        stroke: isPiiHighlighted ? '#ef4444' : edgeColor,
        strokeWidth: isPiiHighlighted ? 3 : 2,
      },
      data: { route },
    })
  }

  flowNodes.value = nodes
  flowEdges.value = edges
}

/* ---- Load routes ---- */

async function loadRoutes(): Promise<void> {
  loading.value = true
  errorMessage.value = null

  try {
    await ontologyStore.loadOntology()

    const params = new URLSearchParams({ enabled: 'true' })
    if (sourceFilter.value) {
      params.set('source', sourceFilter.value)
    }

    routes.value = await api.get<DataRoute[]>(`/api/data-routes?${params.toString()}`)
    buildFlow()
  } catch (err) {
    errorMessage.value =
      err instanceof Error ? err.message : 'Failed to load data routes'
  } finally {
    loading.value = false
  }
}

/* ---- Node click ---- */

function handleNodeClick(event: { node: Node }): void {
  const nodeId = event.node.id
  const isSource = nodeId.startsWith('src-')
  const isDest = nodeId.startsWith('dest-')

  if (isSource || isDest) {
    const conceptKey = nodeId.replace(/^(src-|dest-)/, '')
    const concept = ontologyStore.getConceptByKey(conceptKey)
    const fields = (concept?.properties ?? []).map((p) => ({
      key: p.key,
      label: p.label,
      type: p.type,
      isPii: p.hidden === true, // simplified PII check
    }))

    // Find routes for this concept
    const relatedRoutes = routes.value.filter(
      (r) =>
        r.sourceConceptKey === conceptKey || r.destConceptKey === conceptKey,
    )

    selectedDetail.value = {
      type: isSource ? 'Source Concept' : 'Destination Concept',
      route: relatedRoutes[0],
      fields,
    }
    detailPanelVisible.value = true
  }
}

/* ---- Lifecycle ---- */

onMounted(() => {
  loadRoutes()
})
</script>
