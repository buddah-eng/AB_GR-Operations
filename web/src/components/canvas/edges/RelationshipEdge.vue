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
      class="relationship-edge-label"
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
import type { RelationshipEdgeData } from '@/types/canvas'

const props = defineProps<
  EdgeProps<RelationshipEdgeData> & {
    id: string
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourcePosition: string
    targetPosition: string
    data?: RelationshipEdgeData
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

const labelText = computed(() => {
  const cardinality = props.data?.cardinality
  const label = props.data?.label
  if (cardinality && label) return `${label} (${cardinality})`
  return label ?? cardinality ?? ''
})

const edgeStyle = computed(() => ({
  stroke: 'var(--primary-400)',
  strokeWidth: 2,
}))
</script>

<style scoped>
.relationship-edge-label {
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 2px var(--space-2);
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  box-shadow: var(--shadow-xs);
  transition: all var(--duration-fast) var(--ease-default);
  cursor: default;
  white-space: nowrap;
}

.relationship-edge-label:hover {
  box-shadow: var(--shadow-sm);
  color: var(--text-primary);
  border-color: var(--primary-300);
}
</style>
