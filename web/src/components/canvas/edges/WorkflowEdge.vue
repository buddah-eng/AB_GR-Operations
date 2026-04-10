<template>
  <BaseEdge
    :id="id"
    :path="path"
    :style="edgeStyle"
    :marker-end="markerEnd"
  />
  <EdgeLabelRenderer>
    <div
      v-if="labelText"
      :style="{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all',
      }"
      class="workflow-edge-label"
    >
      {{ labelText }}
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@vue-flow/core'
import type { WorkflowEdgeData } from '@/types/canvas'

const props = defineProps<
  EdgeProps<WorkflowEdgeData> & {
    id: string
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourcePosition: string
    targetPosition: string
    data?: WorkflowEdgeData
    markerEnd?: string
  }
>()

const pathResult = computed(() =>
  getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition as never,
    targetPosition: props.targetPosition as never,
  }),
)

const path = computed(() => pathResult.value[0])
const labelX = computed(() => pathResult.value[1])
const labelY = computed(() => pathResult.value[2])

const labelText = computed(() => props.data?.label ?? '')

const edgeStyle = computed(() => ({
  stroke: '#a855f7',
  strokeWidth: 2.5,
  animation: 'pulse-edge 2s ease-in-out infinite',
}))
</script>

<style>
@keyframes pulse-edge {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>

<style scoped>
.workflow-edge-label {
  background: var(--color-purple-bg);
  border: var(--border-thin) solid var(--color-purple-bg-border);
  border-radius: var(--radius-md);
  padding: 2px var(--space-2);
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  color: var(--color-purple);
  box-shadow: var(--shadow-xs);
  transition: all var(--duration-fast) var(--ease-default);
  cursor: default;
  white-space: nowrap;
}

.workflow-edge-label:hover {
  box-shadow: var(--shadow-sm);
  border-color: var(--color-purple-border-hover);
  transform: scale(1.05);
}
</style>
