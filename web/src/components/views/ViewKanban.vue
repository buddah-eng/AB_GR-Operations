<template>
  <div class="view-kanban" role="region" aria-label="Kanban board">
    <!-- Loading state -->
    <div v-if="loading" class="flex gap-4" aria-busy="true">
      <div v-for="n in 3" :key="n" class="flex-1 min-w-[250px]">
        <Skeleton width="100%" height="2rem" class="mb-3" />
        <Skeleton v-for="m in 3" :key="m" width="100%" height="5rem" class="mb-2" />
      </div>
    </div>

    <!-- Empty state -->
    <Message
      v-else-if="groups.length === 0"
      severity="info"
      :closable="false"
    >
      No data to display. Add records with a status or category field to see
      them organized here.
    </Message>

    <!-- Kanban columns -->
    <div v-else class="flex gap-4 overflow-x-auto pb-4">
      <div
        v-for="group in groups"
        :key="group.key"
        class="flex-shrink-0 w-72 bg-surface-50 rounded-xl p-3"
        role="list"
        :aria-label="`${group.label} column`"
      >
        <!-- Column header -->
        <div class="flex items-center justify-between mb-3 px-1">
          <div class="flex items-center gap-2">
            <span
              v-if="group.color"
              class="w-3 h-3 rounded-full"
              :style="{ backgroundColor: group.color }"
            />
            <h3 class="text-sm font-semibold text-surface-700">
              {{ group.label }}
            </h3>
          </div>
          <span class="text-xs font-medium text-surface-400 bg-surface-200 px-2 py-0.5 rounded-full">
            {{ group.items.length }}
          </span>
        </div>

        <!-- Cards -->
        <div class="space-y-2">
          <div
            v-for="item in group.items"
            :key="getItemId(item)"
            class="bg-white rounded-lg p-3 shadow-sm border border-surface-100 cursor-pointer
                   hover:shadow-md hover:border-primary/30 transition-all duration-150"
            role="listitem"
            tabindex="0"
            :aria-label="getItemTitle(item)"
            draggable="true"
            @click="handleCardClick(item)"
            @keydown.enter="handleCardClick(item)"
            @dragstart="handleDragStart($event, item, group.key)"
            @dragend="handleDragEnd"
          >
            <div class="text-sm font-medium text-surface-800 mb-1">
              {{ getItemTitle(item) }}
            </div>
            <div
              v-if="getItemSubtitle(item)"
              class="text-xs text-surface-500"
            >
              {{ getItemSubtitle(item) }}
            </div>
          </div>

          <!-- Empty column state -->
          <div
            v-if="group.items.length === 0"
            class="text-center py-6 text-xs text-surface-400"
          >
            No items
          </div>
        </div>

        <!-- Drop zone -->
        <div
          class="mt-2 rounded-lg border-2 border-dashed border-transparent p-2 transition-colors"
          :class="{ 'border-primary/40 bg-primary/5': dragOverGroup === group.key }"
          @dragover.prevent="dragOverGroup = group.key"
          @dragleave="dragOverGroup = null"
          @drop.prevent="handleDrop(group.key)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Skeleton from 'primevue/skeleton'
import Message from 'primevue/message'

import type { ViewConfig } from '@/types/views'

interface Props {
  config: ViewConfig
  data: Record<string, unknown>[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
})

const emit = defineEmits<{
  'card-click': [record: Record<string, unknown>]
  'card-move': [event: { recordId: string; fromGroup: string; toGroup: string }]
}>()

interface KanbanGroup {
  key: string
  label: string
  color?: string
  items: Record<string, unknown>[]
}

const dragOverGroup = ref<string | null>(null)
const dragItem = ref<Record<string, unknown> | null>(null)
const dragFromGroup = ref<string | null>(null)

const groupByField = computed(() => props.config.groupBy ?? 'status')

const groups = computed<KanbanGroup[]>(() => {
  const field = groupByField.value
  const groupMap = new Map<string, Record<string, unknown>[]>()

  for (const record of props.data) {
    const groupValue = String(record[field] ?? 'Uncategorized')
    const existing = groupMap.get(groupValue)
    if (existing) {
      existing.push(record)
    } else {
      groupMap.set(groupValue, [record])
    }
  }

  return Array.from(groupMap.entries()).map(([key, items]) => ({
    key,
    label: key,
    items,
  }))
})

function getItemId(item: Record<string, unknown>): string {
  return String(item.id ?? item.key ?? Math.random())
}

function getItemTitle(item: Record<string, unknown>): string {
  return String(item.name ?? item.title ?? item.label ?? item.id ?? 'Untitled')
}

function getItemSubtitle(item: Record<string, unknown>): string | null {
  const value = item.description ?? item.subtitle ?? null
  return value ? String(value) : null
}

function handleCardClick(item: Record<string, unknown>): void {
  emit('card-click', item)
}

function handleDragStart(
  _event: DragEvent,
  item: Record<string, unknown>,
  fromGroup: string,
): void {
  dragItem.value = item
  dragFromGroup.value = fromGroup
}

function handleDragEnd(): void {
  dragItem.value = null
  dragFromGroup.value = null
  dragOverGroup.value = null
}

function handleDrop(toGroup: string): void {
  if (dragItem.value && dragFromGroup.value && dragFromGroup.value !== toGroup) {
    emit('card-move', {
      recordId: getItemId(dragItem.value),
      fromGroup: dragFromGroup.value,
      toGroup,
    })
  }
  dragOverGroup.value = null
}
</script>
