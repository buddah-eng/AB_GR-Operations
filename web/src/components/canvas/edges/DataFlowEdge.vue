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
      :class="['dataflow-edge-label', hasPii ? 'dataflow-edge-label--pii' : 'dataflow-edge-label--normal']"
    >
      <span v-if="hasPii" class="dataflow-edge-label__shield">
        <i class="pi pi-shield" />
      </span>
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
import type { DataFlowEdgeData } from '@/types/canvas'

const props = defineProps<
  EdgeProps<DataFlowEdgeData> & {
    id: string
    sourceX: number
    sourceY: number
    targetX: number
    targetY: number
    sourcePosition: string
    targetPosition: string
    data?: DataFlowEdgeData
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
const hasPii = computed(() => props.data?.hasPii ?? false)

const edgeStyle = computed(() => ({
  stroke: hasPii.value ? 'var(--color-error)' : 'var(--accent-500)',
  strokeWidth: 2,
  strokeDasharray: '6 4',
}))
</script>

<style scoped>
.dataflow-edge-label {
  border-radius: var(--radius-md);
  padding: 2px var(--space-2);
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-xs);
  transition: all var(--duration-fast) var(--ease-default);
  cursor: default;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.dataflow-edge-label:hover {
  box-shadow: var(--shadow-sm);
  transform: scale(1.05);
}

.dataflow-edge-label--normal {
  background: var(--accent-50);
  border: var(--border-thin) solid var(--accent-200);
  color: var(--accent-700);
}

.dataflow-edge-label--pii {
  background: var(--color-error-bg);
  border: var(--border-thin) solid var(--color-error-border-accent);
  color: var(--color-error-text-dark);
}

.dataflow-edge-label__shield {
  font-size: 9px;
  display: flex;
  align-items: center;
}
</style>
