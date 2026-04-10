<template>
  <div class="end-node flex items-center justify-center">
    <div
      :class="[
        'w-10 h-10 rounded-full flex items-center justify-center shadow-sm',
        data.type === 'success' ? 'bg-green-500' : 'bg-gray-400',
      ]"
      :title="data.type === 'success' ? 'Workflow complete' : 'Workflow skipped (condition not met)'"
    >
      <i
        :class="[
          'text-white text-sm',
          data.type === 'success' ? 'pi pi-check' : 'pi pi-minus',
        ]"
      />
    </div>

    <!-- Handle -->
    <Handle type="target" :position="Position.Left" class="!bg-surface-400 !w-2 !h-2" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

export interface EndNodeData {
  readonly type: 'success' | 'skipped'
}

defineProps<{ data: EndNodeData }>()
</script>
