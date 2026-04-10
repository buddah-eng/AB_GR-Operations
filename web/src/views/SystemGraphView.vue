<template>
  <div class="space-y-4">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <i class="pi pi-share-alt text-xl text-ab-500" />
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          System Graph
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <!-- Zoom level selector -->
        <div class="flex items-center border border-surface-200 rounded-md overflow-hidden">
          <button
            v-for="level in zoomLevels"
            :key="level.value"
            :class="[
              'px-3 py-1.5 text-xs font-medium transition-colors',
              canvasStore.zoomLevel === level.value
                ? 'bg-ab-500 text-white'
                : 'bg-white text-surface-600 hover:bg-surface-50',
            ]"
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
          :class="[
            'inline-block w-2 h-2 rounded-full',
            sseConnected ? 'bg-green-400' : 'bg-red-400',
          ]"
          :title="sseConnected ? 'Live connection active' : 'Disconnected'"
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
    <div
      v-if="canvasStore.error"
      class="rounded-lg border-l-4 border-red-400 bg-red-50 px-5 py-4"
    >
      <div class="flex items-center gap-2">
        <i class="pi pi-exclamation-circle text-red-500" />
        <span class="text-sm font-medium text-red-700">
          {{ canvasStore.error }}
        </span>
      </div>
      <button
        class="mt-2 text-xs text-red-600 underline hover:text-red-800"
        @click="canvasStore.loadGraph()"
      >
        Try again
      </button>
    </div>

    <!-- Loading state -->
    <div
      v-if="canvasStore.loading && !canvasStore.hasData"
      class="flex flex-col items-center justify-center py-20"
    >
      <ProgressSpinner
        style="width: 40px; height: 40px"
        strokeWidth="4"
        aria-label="Loading graph data"
      />
      <span class="mt-3 text-sm text-surface-500">
        Loading system graph...
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!canvasStore.hasData && !canvasStore.loading && !canvasStore.error"
      class="flex flex-col items-center justify-center py-20"
    >
      <i class="pi pi-share-alt text-4xl text-surface-300 mb-3" />
      <h2 class="text-lg font-semibold text-surface-600">No Graph Data</h2>
      <p class="text-sm text-surface-400 mt-1 max-w-md text-center">
        The system graph has not been generated yet. Once ontology data is
        available, the visualization will appear here automatically.
      </p>
      <Button
        label="Load Graph"
        icon="pi pi-refresh"
        severity="secondary"
        size="small"
        class="mt-4"
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
      class="w-80"
    >
      <div v-if="canvasStore.selectedNode" class="space-y-4">
        <!-- Node type -->
        <div>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-1">
            Type
          </div>
          <Tag :value="canvasStore.selectedNode.type" rounded />
        </div>

        <!-- Source -->
        <div>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-1">
            Source
          </div>
          <div class="text-sm text-surface-700">
            {{ canvasStore.selectedNode.sourceTable }} / {{ canvasStore.selectedNode.sourceId }}
          </div>
        </div>

        <!-- Region -->
        <div v-if="canvasStore.selectedNode.region">
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-1">
            Department
          </div>
          <div class="text-sm text-surface-700">
            {{ canvasStore.selectedNode.region }}
          </div>
        </div>

        <!-- Properties -->
        <div v-if="Object.keys(canvasStore.selectedNode.properties).length > 0">
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-2">
            Properties
          </div>
          <div class="space-y-2">
            <div
              v-for="(value, key) in canvasStore.selectedNode.properties"
              :key="String(key)"
              class="flex justify-between items-start gap-2 py-1.5 border-b border-surface-50 last:border-0"
            >
              <span class="text-xs font-medium text-surface-500 shrink-0">
                {{ formatPropertyKey(String(key)) }}
              </span>
              <span class="text-xs text-surface-800 text-right break-words">
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
