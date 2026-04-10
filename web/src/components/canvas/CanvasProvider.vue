<template>
  <div
    ref="containerRef"
    :class="[
      'canvas-provider',
      canvasStore.isFullscreen ? 'canvas-provider--fullscreen' : '',
    ]"
  >
    <!-- Toolbar -->
    <div class="canvas-provider__toolbar">
      <CanvasToolbar
        @zoom-in="handleZoomIn"
        @zoom-out="handleZoomOut"
        @fit-view="handleFitView"
        @toggle-fullscreen="handleToggleFullscreen"
      />
    </div>

    <!-- Viewport -->
    <div class="canvas-provider__viewport">
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
import { ref, provide, watchEffect } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasRBAC, type CanvasPermissions } from '@/composables/useCanvasRBAC'
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
const rbac = useCanvasRBAC()
const { zoomIn, zoomOut, fitView } = useVueFlow()
const containerRef = ref<HTMLElement | null>(null)

/* ---- Provide RBAC to children (e.g. CanvasViewport nodes) ---- */

provide<CanvasPermissions>('canvasRBAC', rbac)

/* ---- Enforce read-only: if RBAC says read-only, force view mode ---- */

watchEffect(() => {
  if (rbac.isReadOnly.value && canvasStore.mode === 'edit') {
    canvasStore.setMode('view')
  }
})

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

<style scoped>
.canvas-provider {
  display: flex;
  flex-direction: column;
  background: var(--surface-50);
  border-radius: var(--radius-xl);
  border: var(--border-thin) solid var(--border-color);
  overflow: hidden;
  height: calc(100vh - 160px);
  transition: all var(--duration-normal) var(--ease-default);
}

.canvas-provider--fullscreen {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  border-radius: 0;
  height: 100vh;
}

.canvas-provider__toolbar {
  flex-shrink: 0;
  padding: var(--space-3);
  border-bottom: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
  backdrop-filter: blur(12px);
}

.canvas-provider__viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
}
</style>
