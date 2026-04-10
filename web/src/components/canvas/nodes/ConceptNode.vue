<template>
  <div
    :class="[
      'concept-node rounded-lg border-2 shadow-sm px-4 py-3 min-w-[160px] cursor-pointer',
      'transition-all duration-150 hover:shadow-md',
      selected ? 'border-primary-500 ring-2 ring-primary-200' : 'border-surface-300',
    ]"
    :style="{ borderLeftColor: data.departmentColor, borderLeftWidth: '4px' }"
  >
    <!-- Header row -->
    <div class="flex items-center gap-2 mb-1">
      <i
        :class="[data.icon || 'pi pi-circle', 'text-sm']"
        :style="{ color: data.departmentColor }"
      />
      <span class="text-sm font-semibold text-surface-900 truncate">
        {{ data.label }}
      </span>
    </div>

    <!-- Property count badge -->
    <div
      v-if="data.propertyCount > 0"
      class="flex items-center gap-1 mt-1"
    >
      <span class="text-[10px] font-medium text-surface-500 bg-surface-100 rounded-full px-2 py-0.5">
        {{ data.propertyCount }} {{ data.propertyCount === 1 ? 'property' : 'properties' }}
      </span>
    </div>

    <!-- Connection handles -->
    <Handle type="target" :position="Position.Left" class="!bg-surface-400 !w-2 !h-2" />
    <Handle type="source" :position="Position.Right" class="!bg-surface-400 !w-2 !h-2" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { ConceptNodeData } from '@/types/canvas'

defineProps<{
  data: ConceptNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>

<style scoped>
.concept-node {
  background: white;
}
</style>
