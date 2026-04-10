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
      class="edge-label bg-white border border-surface-200 rounded px-1.5 py-0.5 text-[10px] font-medium text-surface-600 shadow-sm"
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
  stroke: '#94a3b8',
  strokeWidth: 2,
}))
</script>
