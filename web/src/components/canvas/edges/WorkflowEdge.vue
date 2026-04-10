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
      class="edge-label bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 text-[10px] font-medium text-purple-700 shadow-sm"
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
