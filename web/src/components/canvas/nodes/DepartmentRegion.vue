<template>
  <div
    class="department-region rounded-xl border-2 border-dashed p-4 min-w-[280px] min-h-[200px]"
    :style="{
      borderColor: data.color + '80',
      backgroundColor: data.color + '08',
    }"
  >
    <!-- Region label -->
    <div class="flex items-center gap-2 mb-3">
      <span
        class="w-3 h-3 rounded-full"
        :style="{ backgroundColor: data.color }"
      />
      <span
        class="text-xs font-bold uppercase tracking-widest"
        :style="{ color: data.color }"
      >
        {{ data.label }}
      </span>
      <span class="text-[10px] text-surface-400 ml-auto">
        {{ data.nodeIds.length }} {{ data.nodeIds.length === 1 ? 'node' : 'nodes' }}
      </span>
    </div>

    <!-- No handles needed for region nodes (they are grouping containers) -->
  </div>
</template>

<script setup lang="ts">
import type { DepartmentRegionData } from '@/types/canvas'

defineProps<{
  data: DepartmentRegionData
}>()
</script>
