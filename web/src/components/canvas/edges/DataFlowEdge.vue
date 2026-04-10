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
      :class="[
        'edge-label rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm',
        hasPii
          ? 'bg-red-50 border border-red-300 text-red-700'
          : 'bg-amber-50 border border-amber-200 text-amber-700',
      ]"
    >
      <span v-if="hasPii" class="mr-1">
        <i class="pi pi-shield text-[9px]" />
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
  stroke: hasPii.value ? '#ef4444' : '#f59e0b',
  strokeWidth: 2,
  strokeDasharray: '6 4',
}))
</script>
