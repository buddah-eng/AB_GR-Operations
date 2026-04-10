<template>
  <div
    :class="['integration-node', 'canvas-node', selected ? 'selected' : '']"
  >
    <!-- Header row -->
    <div class="integration-node__header">
      <i class="pi pi-cloud integration-node__icon" />
      <span class="integration-node__label">
        {{ data.label }}
      </span>
    </div>

    <!-- Type indicator -->
    <div class="integration-node__badge-row">
      <span class="integration-node__badge">
        External System
      </span>
    </div>

    <!-- Connection handles -->
    <Handle type="target" :position="Position.Left" class="integration-node__handle" />
    <Handle type="source" :position="Position.Right" class="integration-node__handle" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { IntegrationNodeData } from '@/types/canvas'

defineProps<{
  data: IntegrationNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>

<style scoped>
.integration-node {
  background: var(--color-sky-bg);
  min-width: 160px;
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  border-color: var(--color-sky-border);
}

.integration-node.selected {
  border-color: var(--color-sky);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.15);
}

.integration-node__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.integration-node__icon {
  font-size: var(--text-sm);
  color: var(--color-sky);
  flex-shrink: 0;
}

.integration-node__label {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: var(--tracking-tight);
}

.integration-node__badge-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.integration-node__badge {
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  color: var(--color-sky-text);
  background: rgba(14, 165, 233, 0.1);
  border-radius: var(--radius-full);
  padding: 2px var(--space-2);
  letter-spacing: var(--tracking-wide);
}

.integration-node__handle {
  width: 8px !important;
  height: 8px !important;
  background: var(--color-sky-handle) !important;
  border: var(--border-thin) solid var(--color-sky-bg) !important;
  transition: all var(--duration-fast) var(--ease-default);
}

.integration-node:hover .integration-node__handle {
  background: var(--color-sky) !important;
  transform: scale(1.2);
}
</style>
