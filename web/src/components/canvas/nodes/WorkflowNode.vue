<template>
  <div
    :class="['workflow-node', 'canvas-node', selected ? 'selected' : '']"
  >
    <!-- Header row -->
    <div class="workflow-node__header">
      <i class="pi pi-sitemap workflow-node__icon" />
      <span class="workflow-node__label">
        {{ data.label }}
      </span>
    </div>

    <!-- Status indicator -->
    <div class="workflow-node__status">
      <span class="workflow-node__pulse" />
      <span class="workflow-node__type-label">Workflow</span>
    </div>

    <!-- Connection handles -->
    <Handle type="target" :position="Position.Left" class="workflow-node__handle" />
    <Handle type="source" :position="Position.Right" class="workflow-node__handle" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { WorkflowNodeData } from '@/types/canvas'

defineProps<{
  data: WorkflowNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>

<style scoped>
.workflow-node {
  background: #faf5ff;
  min-width: 160px;
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  border-style: dashed;
  border-color: #d8b4fe;
}

.workflow-node.selected {
  border-color: #a855f7;
  box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15);
}

.workflow-node__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.workflow-node__icon {
  font-size: var(--text-sm);
  color: #a855f7;
  flex-shrink: 0;
}

.workflow-node__label {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: var(--tracking-tight);
}

.workflow-node__status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.workflow-node__pulse {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: #c084fc;
  animation: workflow-pulse 2s var(--ease-default) infinite;
}

@keyframes workflow-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

.workflow-node__type-label {
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.workflow-node__handle {
  width: 8px !important;
  height: 8px !important;
  background: #c084fc !important;
  border: var(--border-thin) solid #faf5ff !important;
  transition: all var(--duration-fast) var(--ease-default);
}

.workflow-node:hover .workflow-node__handle {
  background: #a855f7 !important;
  transform: scale(1.2);
}
</style>
