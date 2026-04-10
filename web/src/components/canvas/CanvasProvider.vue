<template>
  <div
    ref="containerRef"
    :class="[
      'canvas-provider flex flex-col bg-surface-50 rounded-xl border border-surface-200 overflow-hidden',
      canvasStore.isFullscreen ? 'fixed inset-0 z-50 rounded-none' : 'h-[calc(100vh-160px)]',
    ]"
  >
    <!-- Toolbar -->
    <div class="shrink-0 p-2 border-b border-surface-200 bg-white">
      <CanvasToolbar
        @zoom-in="handleZoomIn"
        @zoom-out="handleZoomOut"
        @fit-view="handleFitView"
        @toggle-fullscreen="handleToggleFullscreen"
      />
    </div>

    <!-- Viewport -->
    <div class="flex-1 relative overflow-hidden">
      <slot>
        <CanvasViewport
          @node-click="handleNodeClick"
          @node-context-menu="handleNodeContextMenu"
          @pane-click="handlePaneClick"
        />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import CanvasToolbar from './CanvasToolbar.vue'
import CanvasViewport from './CanvasViewport.vue'

/* ---- Emits ---- */

const emit = defineEmits<{
  'node-click': [nodeId: string]
  'node-context-menu': [event: MouseEvent, nodeId: string]
  'pane-click': []
}>()

/* ---- Store & Flow ---- */

const canvasStore = useCanvasStore()
const { zoomIn, zoomOut, fitView } = useVueFlow()
const containerRef = ref<HTMLElement | null>(null)

/* ---- Zoom handlers ---- */

function handleZoomIn(): void {
  zoomIn()
}

function handleZoomOut(): void {
  zoomOut()
}

function handleFitView(): void {
  fitView({ padding: 0.2 })
}

/* ---- Fullscreen ---- */

function handleToggleFullscreen(): void {
  canvasStore.setFullscreen(!canvasStore.isFullscreen)
}

/* ---- Event passthrough ---- */

function handleNodeClick(nodeId: string): void {
  emit('node-click', nodeId)
}

function handleNodeContextMenu(event: MouseEvent, nodeId: string): void {
  emit('node-context-menu', event, nodeId)
}

function handlePaneClick(): void {
  emit('pane-click')
}
</script>
