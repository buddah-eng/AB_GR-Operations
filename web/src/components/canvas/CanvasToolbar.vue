<template>
  <div class="canvas-toolbar">
    <!-- Mode selector -->
    <div class="toolbar-segment">
      <button
        :class="['toolbar-mode-btn', canvasStore.mode === 'view' ? 'toolbar-mode-btn--active' : '']"
        title="View mode"
        @click="canvasStore.setMode('view')"
      >
        <i class="pi pi-eye" />
        <span>View</span>
      </button>
      <button
        v-if="!isReadOnly"
        :class="['toolbar-mode-btn', canvasStore.mode === 'edit' ? 'toolbar-mode-btn--active' : '']"
        title="Edit mode"
        @click="canvasStore.setMode('edit')"
      >
        <i class="pi pi-pencil" />
        <span>Edit</span>
      </button>
    </div>

    <div class="toolbar-divider" />

    <!-- Layout selector -->
    <select
      :value="canvasStore.layout"
      class="toolbar-select"
      @change="handleLayoutChange"
    >
      <option value="force-directed">Force Directed</option>
      <option value="hierarchical">Hierarchical</option>
      <option value="radial">Radial</option>
      <option value="grid">Grid</option>
    </select>

    <div class="toolbar-divider" />

    <!-- Overlay toggles (gated by RBAC) -->
    <button
      v-if="visibleOverlays.includes('data_flows')"
      :class="['toolbar-toggle-btn', canvasStore.isOverlayActive('data_flows') ? 'toolbar-toggle-btn--active-amber' : '']"
      title="Toggle data flows overlay"
      @click="canvasStore.toggleOverlay('data_flows')"
    >
      <i class="pi pi-arrows-h" />
      <span>Data Flows</span>
    </button>
    <button
      v-if="visibleOverlays.includes('workflows')"
      :class="['toolbar-toggle-btn', canvasStore.isOverlayActive('workflows') ? 'toolbar-toggle-btn--active-purple' : '']"
      title="Toggle workflows overlay"
      @click="canvasStore.toggleOverlay('workflows')"
    >
      <i class="pi pi-sitemap" />
      <span>Workflows</span>
    </button>

    <div class="toolbar-divider" />

    <!-- Search -->
    <div class="toolbar-search">
      <i class="pi pi-search toolbar-search__icon" />
      <input
        :value="canvasStore.searchQuery"
        type="text"
        placeholder="Search nodes..."
        class="toolbar-search__input"
        @input="handleSearch"
      />
    </div>

    <!-- Spacer -->
    <div class="toolbar-spacer" />

    <!-- Zoom controls -->
    <div class="toolbar-zoom">
      <button
        class="toolbar-icon-btn"
        title="Zoom out"
        @click="$emit('zoom-out')"
      >
        <i class="pi pi-minus" />
      </button>
      <button
        class="toolbar-icon-btn"
        title="Fit view"
        @click="$emit('fit-view')"
      >
        <i class="pi pi-arrows-alt" />
      </button>
      <button
        class="toolbar-icon-btn"
        title="Zoom in"
        @click="$emit('zoom-in')"
      >
        <i class="pi pi-plus" />
      </button>
    </div>

    <div class="toolbar-divider" />

    <!-- Fullscreen toggle -->
    <button
      class="toolbar-icon-btn"
      :title="canvasStore.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
      @click="$emit('toggle-fullscreen')"
    >
      <i :class="canvasStore.isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" />
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

<style scoped>
.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-lg);
  padding: var(--space-2) var(--space-3);
  box-shadow: var(--shadow-sm);
  font-family: var(--font-display);
}

/* Mode selector segment */
.toolbar-segment {
  display: flex;
  align-items: center;
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.toolbar-mode-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-wide);
  color: var(--text-secondary);
  background: var(--bg-card);
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.toolbar-mode-btn:hover {
  background: var(--surface-50);
}

.toolbar-mode-btn--active {
  background: var(--primary-600);
  color: var(--text-inverse);
}

.toolbar-mode-btn--active:hover {
  background: var(--primary-700);
}

.toolbar-mode-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

/* Divider */
.toolbar-divider {
  width: 1px;
  height: var(--space-6);
  background: var(--surface-200);
  flex-shrink: 0;
}

/* Select */
.toolbar-select {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-default);
}

.toolbar-select:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-100);
}

/* Toggle buttons */
.toolbar-toggle-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.toolbar-toggle-btn:hover {
  background: var(--surface-50);
  border-color: var(--surface-300);
}

.toolbar-toggle-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.toolbar-toggle-btn--active-amber {
  background: var(--accent-50);
  color: var(--accent-700);
  border-color: var(--accent-300);
}

.toolbar-toggle-btn--active-purple {
  background: var(--color-purple-bg);
  color: var(--color-purple);
  border-color: var(--color-purple-border);
}

/* Search */
.toolbar-search {
  position: relative;
}

.toolbar-search__icon {
  position: absolute;
  left: var(--space-2);
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: var(--text-xs);
  pointer-events: none;
}

.toolbar-search__input {
  font-size: var(--text-xs);
  color: var(--text-primary);
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-8);
  width: 10rem;
  transition: all var(--duration-fast) var(--ease-default);
}

.toolbar-search__input:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-100);
  width: 14rem;
}

.toolbar-search__input::placeholder {
  color: var(--text-muted);
}

/* Spacer */
.toolbar-spacer {
  flex: 1;
}

/* Zoom controls */
.toolbar-zoom {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

/* Icon buttons */
.toolbar-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-md);
  border: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--text-xs);
  transition: all var(--duration-fast) var(--ease-default);
}

.toolbar-icon-btn:hover {
  background: var(--surface-50);
  border-color: var(--surface-300);
  transform: translateY(-1px);
}

.toolbar-icon-btn:active {
  transform: translateY(0);
}

.toolbar-icon-btn:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
</style>
