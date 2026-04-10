<template>
  <div>
    <h3 class="section-header">Columns</h3>
    <div class="column-list">
      <div
        v-for="(col, idx) in columns"
        :key="col.key"
        class="column-item"
        draggable="true"
        @dragstart="() => { dragIdx = idx }"
        @dragover.prevent
        @drop.prevent="() => handleReorder(idx)"
      >
        <i class="pi pi-grip-vertical column-grip" />
        <span class="column-item__label">{{ col.label }}</span>
        <Tag :value="col.type ?? 'text'" rounded class="!text-[10px]" severity="secondary" />
        <InputText
          :model-value="col.width ?? ''"
          placeholder="auto"
          class="column-item__width"
          aria-label="Column width"
          @update:model-value="(v) => emit('updateWidth', idx, String(v))"
        />
        <ToggleButton
          :model-value="col.visible !== false"
          on-icon="pi pi-eye"
          off-icon="pi pi-eye-slash"
          class="!p-1 !text-xs"
          :aria-label="col.visible !== false ? 'Hide column' : 'Show column'"
          @update:model-value="(v: boolean) => emit('toggleVisible', idx, v)"
        />
        <Button
          icon="pi pi-times"
          severity="danger"
          text
          rounded
          size="small"
          class="!p-1"
          aria-label="Remove column"
          @click="emit('remove', idx)"
        />
      </div>
    </div>

    <div class="column-add">
      <Select
        :options="availableProps"
        option-label="label"
        option-value="key"
        placeholder="Add column..."
        class="w-full"
        @change="(e) => emit('add', e.value as string)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import ToggleButton from 'primevue/togglebutton'

import type { ViewColumn } from '@/types/views'
import type { OntologyProperty } from '@/types'

defineProps<{
  columns: ViewColumn[]
  availableProps: OntologyProperty[]
}>()

const emit = defineEmits<{
  add: [key: string]
  remove: [idx: number]
  updateWidth: [idx: number, width: string]
  toggleVisible: [idx: number, visible: boolean]
  reorder: [fromIdx: number, toIdx: number]
}>()

const dragIdx = ref<number | null>(null)

function handleReorder(targetIdx: number): void {
  if (dragIdx.value === null || dragIdx.value === targetIdx) {
    dragIdx.value = null
    return
  }
  emit('reorder', dragIdx.value, targetIdx)
  dragIdx.value = null
}
</script>

<style scoped>
.column-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.column-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-card);
  border-radius: var(--radius-md);
  border: var(--border-thin) solid var(--border-color);
  transition: all var(--duration-fast) var(--ease-default);
}

.column-item:hover {
  border-color: var(--surface-300);
  box-shadow: var(--shadow-xs);
}

.column-item__label {
  font-size: var(--text-sm);
  color: var(--text-primary);
  flex: 1;
}

.column-item__width {
  width: 5rem;
  font-size: var(--text-xs) !important;
}

.column-grip {
  font-size: var(--text-xs);
  color: var(--surface-300);
  cursor: grab;
}

.column-add {
  margin-top: var(--space-3);
}
</style>
