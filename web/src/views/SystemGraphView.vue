<template>
  <div class="view-page">
    <!-- Header row -->
    <div class="view-header">
      <div class="view-header__left">
        <i class="pi pi-share-alt view-header__icon" />
        <h1 class="page-title">System Graph</h1>
      </div>
      <div class="view-header__right">
        <!-- Zoom level selector -->
        <div class="view-segment-control">
          <button
            v-for="level in zoomLevels"
            :key="level.value"
            :class="['view-segment-btn', canvasStore.zoomLevel === level.value ? 'view-segment-btn--active' : '']"
            :title="level.label"
            @click="canvasStore.setZoomLevel(level.value)"
          >
            {{ level.label }}
          </button>
        </div>

        <!-- Undo / Redo -->
        <Button
          icon="pi pi-undo"
          severity="secondary"
          size="small"
          :disabled="!canUndo"
          title="Undo (Ctrl+Z)"
          @click="undo"
        />
        <Button
          icon="pi pi-replay"
          severity="secondary"
          size="small"
          :disabled="!canRedo"
          title="Redo (Ctrl+Shift+Z)"
          @click="redo"
        />

        <!-- SSE connection indicator -->
        <span
          :class="['view-sse-dot', sseConnected ? 'view-sse-dot--connected' : 'view-sse-dot--disconnected']"
          :title="sseConnected ? 'Live connection active' : 'Offline — data loaded via REST'"
        />

        <Button
          label="Refresh"
          icon="pi pi-refresh"
          severity="secondary"
          size="small"
          :loading="canvasStore.loading"
          @click="canvasStore.loadGraph()"
        />
      </div>
    </div>

    <!-- Error state -->
    <div v-if="canvasStore.error" class="view-error">
      <div class="view-error__content">
        <i class="pi pi-exclamation-circle view-error__icon" />
        <span class="view-error__text">{{ canvasStore.error }}</span>
      </div>
      <button class="view-error__retry" @click="canvasStore.loadGraph()">
        Try again
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="canvasStore.loading && !canvasStore.hasData" class="view-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        strokeWidth="4"
        aria-label="Loading graph data"
      />
      <span class="view-loading__text">Loading system graph...</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!canvasStore.hasData && !canvasStore.loading && !canvasStore.error"
      class="empty-state"
    >
      <div class="icon">
        <i class="pi pi-share-alt" />
      </div>
      <h2>No Graph Data</h2>
      <p>
        The system graph has not been generated yet. Once ontology data is
        available, the visualization will appear here automatically.
      </p>
      <Button
        label="Load Graph"
        icon="pi pi-refresh"
        severity="secondary"
        size="small"
        style="margin-top: var(--space-4)"
        @click="canvasStore.loadGraph()"
      />
    </div>

    <!-- Canvas -->
    <div v-else>
      <CanvasProvider
        @node-click="handleNodeClick"
        @node-context-menu="handleNodeContextMenu"
        @pane-click="handlePaneClick"
      />
    </div>

    <!-- Property panel (slide-in from right) -->
    <Sidebar
      v-model:visible="propertyPanelVisible"
      position="right"
      :header="selectedNodeLabel"
      class="view-sidebar-panel"
    >
      <div v-if="canvasStore.selectedNode" class="view-detail-list">
        <!-- Node type -->
        <div class="view-detail-item">
          <div class="view-detail-item__label">Type</div>
          <Tag :value="canvasStore.selectedNode.type" rounded />
        </div>

        <!-- Source -->
        <div class="view-detail-item">
          <div class="view-detail-item__label">Source</div>
          <div class="view-detail-item__value">
            {{ canvasStore.selectedNode.sourceTable }} / {{ canvasStore.selectedNode.sourceId }}
          </div>
        </div>

        <!-- Region -->
        <div v-if="canvasStore.selectedNode.region" class="view-detail-item">
          <div class="view-detail-item__label">Department</div>
          <div class="view-detail-item__value">
            {{ canvasStore.selectedNode.region }}
          </div>
        </div>

        <!-- Properties -->
        <div v-if="Object.keys(canvasStore.selectedNode.properties).length > 0" class="view-detail-item">
          <div class="view-detail-item__label">Properties</div>
          <div class="view-properties-grid">
            <div
              v-for="(value, key) in canvasStore.selectedNode.properties"
              :key="String(key)"
              class="view-property-row"
            >
              <span class="view-property-row__key">
                {{ formatPropertyKey(String(key)) }}
              </span>
              <span class="view-property-row__value">
                {{ formatPropertyValue(value) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Sidebar>

    <!-- Context menu -->
    <Menu
      ref="contextMenuRef"
      :model="contextMenuItems"
      :popup="true"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Sidebar from 'primevue/sidebar'
import Menu from 'primevue/menu'
import ProgressSpinner from 'primevue/progressspinner'

import CanvasProvider from '@/components/canvas/CanvasProvider.vue'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasConfigBridge } from '@/composables/useCanvasConfigBridge'
import type { ZoomLevel } from '@/types/canvas'

/* ---- Store & Router ---- */

const canvasStore = useCanvasStore()
const router = useRouter()

/* ---- Config bridge (SSE + undo/redo) ---- */

const {
  connectSSE,
  disconnectSSE,
  submitEdit,
  bindKeyboardShortcuts,
  unbindKeyboardShortcuts,
  canUndo,
  canRedo,
  undo,
  redo,
  connected: sseConnected,
} = useCanvasConfigBridge()

/* ---- Zoom levels ---- */

const zoomLevels: ReadonlyArray<{ value: ZoomLevel; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'department', label: 'Department' },
  { value: 'concept', label: 'Concept' },
]

/* ---- Property panel ---- */

const propertyPanelVisible = ref(false)

const selectedNodeLabel = computed(() =>
  canvasStore.selectedNode?.label ?? 'Node Details',
)

watch(
  () => canvasStore.selectedNodeId,
  (nodeId) => {
    propertyPanelVisible.value = nodeId !== null
  },
)

/* ---- Context menu ---- */

const contextMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const contextNodeId = ref<string | null>(null)

const contextMenuItems = computed(() => [
  {
    label: 'View Details',
    icon: 'pi pi-eye',
    command: () => {
      if (contextNodeId.value) {
        canvasStore.selectNode(contextNodeId.value)
      }
    },
  },
  {
    label: 'View in Builder',
    icon: 'pi pi-external-link',
    command: () => {
      if (contextNodeId.value) {
        const node = canvasStore.graph.nodes.find(
          (n) => n.id === contextNodeId.value,
        )
        if (node) {
          navigateToSource(node.sourceTable, node.sourceId)
        }
      }
    },
  },
  { separator: true },
  {
    label: 'Delete',
    icon: 'pi pi-trash',
    class: 'text-red-600',
    disabled: canvasStore.mode !== 'edit',
    command: () => {
      if (!contextNodeId.value) return
      const node = canvasStore.graph.nodes.find(
        (n) => n.id === contextNodeId.value,
      )
      if (!node) return

      submitEdit({
        node: {
          id: node.id,
          type: node.sourceTable,
          department: node.region,
        },
        method: 'DELETE',
        path: `/api/${node.sourceTable}/${node.sourceId}`,
        optimisticId: crypto.randomUUID(),
        optimisticData: null,
      })
    },
  },
])

/* ---- Event handlers ---- */

function handleNodeClick(nodeId: string): void {
  canvasStore.selectNode(nodeId)
}

function handleNodeContextMenu(event: MouseEvent, nodeId: string): void {
  event.preventDefault()
  contextNodeId.value = nodeId
  contextMenuRef.value?.show(event)
}

function handlePaneClick(): void {
  canvasStore.selectNode(null)
}

/* ---- Navigation helpers ---- */

const SOURCE_TABLE_ROUTES: Readonly<Record<string, string>> = {
  guests: '/guests',
  staff: '/staff',
  schedule: '/schedule',
  prep: '/prep-tracker',
  travel: '/travel',
  accommodations: '/accommodations',
  dietary: '/dietary',
  autographs: '/autographs',
  venues: '/venues',
  pairings: '/pairings',
  workflows: '/workflows',
}

function navigateToSource(sourceTable: string, sourceId: string): void {
  const basePath = SOURCE_TABLE_ROUTES[sourceTable]
  if (basePath && sourceId) {
    router.push(`${basePath}/${sourceId}`)
  } else if (basePath) {
    router.push(basePath)
  }
}

/* ---- Property formatting ---- */

function formatPropertyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/* ---- Keyboard shortcuts ---- */

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (propertyPanelVisible.value) {
      propertyPanelVisible.value = false
      canvasStore.selectNode(null)
    } else if (canvasStore.isFullscreen) {
      canvasStore.setFullscreen(false)
    }
  }
}

/* ---- Lifecycle ---- */

onMounted(() => {
  canvasStore.loadGraph()
  connectSSE()
  bindKeyboardShortcuts()
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  disconnectSSE()
  unbindKeyboardShortcuts()
  window.removeEventListener('keydown', handleKeyDown)
  canvasStore.reset()
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

.view-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Segment control */
.view-segment-control {
  display: flex;
  align-items: center;
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.view-segment-btn {
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  background: var(--bg-card);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  letter-spacing: var(--tracking-wide);
}

.view-segment-btn:hover {
  background: var(--surface-50);
}

.view-segment-btn--active {
  background: var(--primary-600);
  color: var(--text-inverse);
}

.view-segment-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

/* SSE indicator */
.view-sse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.view-sse-dot--connected {
  background: var(--color-success);
  box-shadow: 0 0 4px rgba(34, 197, 94, 0.4);
}

.view-sse-dot--disconnected {
  background: var(--surface-300);
  box-shadow: none;
}

/* Error */
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

/* Loading */
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

/* Sidebar panel */
.view-sidebar-panel {
  width: 20rem;
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

.view-detail-item__value {
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.view-properties-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.view-property-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
  padding: 6px 0;
  border-bottom: var(--border-thin) solid var(--surface-100);
}

.view-property-row:last-child {
  border-bottom: none;
}

.view-property-row__key {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  flex-shrink: 0;
}

.view-property-row__value {
  font-size: var(--text-xs);
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
}
</style>
