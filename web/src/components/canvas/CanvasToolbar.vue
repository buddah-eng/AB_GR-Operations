<template>
  <div class="canvas-toolbar flex items-center gap-2 bg-white/90 backdrop-blur-md border border-surface-200 rounded-lg px-3 py-2 shadow-sm">
    <!-- Mode selector -->
    <div class="flex items-center border border-surface-200 rounded-md overflow-hidden">
      <button
        :class="[
          'px-3 py-1.5 text-xs font-medium transition-colors',
          canvasStore.mode === 'view'
            ? 'bg-primary-500 text-white'
            : 'bg-white text-surface-600 hover:bg-surface-50',
        ]"
        title="View mode"
        @click="canvasStore.setMode('view')"
      >
        <i class="pi pi-eye mr-1" />
        View
      </button>
      <button
        v-if="!isReadOnly"
        :class="[
          'px-3 py-1.5 text-xs font-medium transition-colors',
          canvasStore.mode === 'edit'
            ? 'bg-primary-500 text-white'
            : 'bg-white text-surface-600 hover:bg-surface-50',
        ]"
        title="Edit mode"
        @click="canvasStore.setMode('edit')"
      >
        <i class="pi pi-pencil mr-1" />
        Edit
      </button>
    </div>

    <!-- Separator -->
    <div class="w-px h-6 bg-surface-200" />

    <!-- Layout selector -->
    <select
      :value="canvasStore.layout"
      class="text-xs border border-surface-200 rounded-md px-2 py-1.5 bg-white text-surface-700 focus:outline-none focus:ring-1 focus:ring-primary-400"
      @change="handleLayoutChange"
    >
      <option value="force-directed">Force Directed</option>
      <option value="hierarchical">Hierarchical</option>
      <option value="radial">Radial</option>
      <option value="grid">Grid</option>
    </select>

    <!-- Separator -->
    <div class="w-px h-6 bg-surface-200" />

    <!-- Overlay toggles (gated by RBAC) -->
    <button
      v-if="visibleOverlays.includes('data_flows')"
      :class="[
        'px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
        canvasStore.isOverlayActive('data_flows')
          ? 'bg-amber-100 text-amber-700 border border-amber-300'
          : 'bg-white text-surface-500 border border-surface-200 hover:bg-surface-50',
      ]"
      title="Toggle data flows overlay"
      @click="canvasStore.toggleOverlay('data_flows')"
    >
      <i class="pi pi-arrows-h mr-1" />
      Data Flows
    </button>
    <button
      v-if="visibleOverlays.includes('workflows')"
      :class="[
        'px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
        canvasStore.isOverlayActive('workflows')
          ? 'bg-purple-100 text-purple-700 border border-purple-300'
          : 'bg-white text-surface-500 border border-surface-200 hover:bg-surface-50',
      ]"
      title="Toggle workflows overlay"
      @click="canvasStore.toggleOverlay('workflows')"
    >
      <i class="pi pi-sitemap mr-1" />
      Workflows
    </button>

    <!-- Separator -->
    <div class="w-px h-6 bg-surface-200" />

    <!-- Search -->
    <div class="relative">
      <i class="pi pi-search absolute left-2 top-1/2 -translate-y-1/2 text-surface-400 text-xs" />
      <input
        :value="canvasStore.searchQuery"
        type="text"
        placeholder="Search nodes..."
        class="text-xs border border-surface-200 rounded-md pl-7 pr-3 py-1.5 bg-white text-surface-700 w-40 focus:outline-none focus:ring-1 focus:ring-primary-400"
        @input="handleSearch"
      />
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Zoom controls -->
    <div class="flex items-center gap-1">
      <button
        class="w-7 h-7 flex items-center justify-center rounded-md border border-surface-200 bg-white text-surface-600 hover:bg-surface-50 transition-colors"
        title="Zoom out"
        @click="$emit('zoom-out')"
      >
        <i class="pi pi-minus text-xs" />
      </button>
      <button
        class="w-7 h-7 flex items-center justify-center rounded-md border border-surface-200 bg-white text-surface-600 hover:bg-surface-50 transition-colors"
        title="Fit view"
        @click="$emit('fit-view')"
      >
        <i class="pi pi-arrows-alt text-xs" />
      </button>
      <button
        class="w-7 h-7 flex items-center justify-center rounded-md border border-surface-200 bg-white text-surface-600 hover:bg-surface-50 transition-colors"
        title="Zoom in"
        @click="$emit('zoom-in')"
      >
        <i class="pi pi-plus text-xs" />
      </button>
    </div>

    <!-- Separator -->
    <div class="w-px h-6 bg-surface-200" />

    <!-- Fullscreen toggle -->
    <button
      class="w-7 h-7 flex items-center justify-center rounded-md border border-surface-200 bg-white text-surface-600 hover:bg-surface-50 transition-colors"
      :title="canvasStore.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
      @click="$emit('toggle-fullscreen')"
    >
      <i :class="canvasStore.isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" class="text-xs" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { useCanvasStore } from '@/stores/canvas'
import { useCanvasRBAC } from '@/composables/useCanvasRBAC'
import type { CanvasLayoutAlgorithm } from '@/types/canvas'

const canvasStore = useCanvasStore()
const { isReadOnly, visibleOverlays } = useCanvasRBAC()

defineEmits<{
  'zoom-in': []
  'zoom-out': []
  'fit-view': []
  'toggle-fullscreen': []
}>()

function handleLayoutChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  canvasStore.setLayout(target.value as CanvasLayoutAlgorithm)
}

function handleSearch(event: Event): void {
  const target = event.target as HTMLInputElement
  canvasStore.setSearchQuery(target.value)
}
</script>
