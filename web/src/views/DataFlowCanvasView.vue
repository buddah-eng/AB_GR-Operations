<template>
  <div class="view-page">
    <!-- Header row -->
    <div class="view-header">
      <div class="view-header__left">
        <i class="pi pi-arrows-h view-header__icon" />
        <h1 class="page-title">Data Flow Canvas</h1>
        <span class="view-header__subtitle">
          Visualize how data routes from source concepts to destinations
        </span>
      </div>
      <div class="view-header__right">
        <Select
          v-model="sourceFilter"
          :options="sourceConceptOptions"
          option-label="label"
          option-value="value"
          placeholder="Source concept"
          show-clear
          class="view-filter-select"
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
    <div v-if="errorMessage" class="view-error">
      <div class="view-error__content">
        <i class="pi pi-exclamation-circle view-error__icon" />
        <span class="view-error__text">{{ errorMessage }}</span>
      </div>
      <button class="view-error__retry" @click="loadRoutes">
        Try again
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading && flowNodes.length === 0" class="view-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        stroke-width="4"
        aria-label="Loading data flows"
      />
      <span class="view-loading__text">Loading data flows...</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="flowNodes.length === 0 && !loading && !errorMessage"
      class="empty-state"
    >
      <div class="icon">
        <i class="pi pi-arrows-h" />
      </div>
      <h2>No Data Routes</h2>
      <p>
        No data routes configured. Create a route by dragging from a source
        concept to a destination, or use the builder to define routes.
      </p>
    </div>

    <!-- Canvas -->
    <div v-else class="view-canvas-container">
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.85, x: 50, y: 80 }"
        fit-view-on-init
        class="view-canvas-flow"
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
      class="view-sidebar-panel"
    >
      <div v-if="selectedDetail" class="view-detail-list">
        <div class="view-detail-item">
          <div class="view-detail-item__label">Type</div>
          <Tag :value="selectedDetail.type" rounded />
        </div>

        <!-- Route info -->
        <template v-if="selectedDetail.route">
          <div class="view-detail-item">
            <div class="view-detail-item__label">PII Filter Mode</div>
            <Tag
              :value="selectedDetail.route.piiFilterMode"
              :severity="piiSeverity(selectedDetail.route.piiFilterMode)"
              rounded
            />
          </div>
          <div class="view-detail-item">
            <div class="view-detail-item__label">Field Mappings</div>
            <div class="view-field-mappings">
              <div
                v-for="mapping in selectedDetail.route.fieldMappings"
                :key="`${mapping.sourceField}-${mapping.destField}`"
                class="view-field-mapping"
              >
                <span class="view-field-mapping__source">{{ mapping.sourceField }}</span>
                <i class="pi pi-arrow-right view-field-mapping__arrow" />
                <span class="view-field-mapping__dest">{{ mapping.destField }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Concept fields -->
        <template v-if="selectedDetail.fields">
          <div class="view-detail-item">
            <div class="view-detail-item__label">Fields</div>
            <div class="view-concept-fields">
              <div
                v-for="field in selectedDetail.fields"
                :key="field.key"
                class="view-concept-field"
              >
                <i
                  v-if="field.isPii"
                  class="pi pi-lock view-concept-field__pii-icon"
                  title="PII field"
                />
                <span :class="field.isPii ? 'view-concept-field__name--pii' : 'view-concept-field__name'">
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

<style scoped>
.view-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-header__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.view-header__icon {
  font-size: var(--text-xl);
  color: var(--primary-500);
}

.view-header__subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.view-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.view-filter-select {
  width: 12rem;
}

.view-error {
  border-radius: var(--radius-lg);
  border-left: 4px solid var(--color-error);
  background: var(--color-error-bg);
  padding: var(--space-4) var(--space-5);
}

.view-error__content {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.view-error__icon {
  color: var(--color-error);
}

.view-error__text {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-error-text-dark);
}

.view-error__retry {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-error-text-mid);
  text-decoration: underline;
  background: none;
  border: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-default);
}

.view-error__retry:hover {
  color: var(--color-error-text);
}

.view-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-20) 0;
}

.view-loading__text {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.view-canvas-container {
  border-radius: var(--radius-xl);
  border: var(--border-thin) solid var(--border-color);
  overflow: hidden;
  background: var(--surface-50);
  height: calc(100vh - 200px);
}

.view-canvas-flow {
  width: 100%;
  height: 100%;
}

.view-sidebar-panel {
  width: 24rem;
}

.view-detail-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.view-detail-item__label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--text-muted);
  margin-bottom: var(--space-1);
}

.view-field-mappings {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.view-field-mapping {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.view-field-mapping__source {
  font-weight: var(--weight-medium);
}

.view-field-mapping__arrow {
  color: var(--surface-300);
  font-size: 10px;
}

.view-concept-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.view-concept-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
}

.view-concept-field__pii-icon {
  color: var(--color-error);
  font-size: 10px;
}

.view-concept-field__name {
  color: var(--text-secondary);
}

.view-concept-field__name--pii {
  color: var(--color-error);
  font-weight: var(--weight-medium);
}
</style>
