<template>
  <div class="vk-root" role="region" aria-label="Kanban board">
    <!-- Loading skeleton -->
    <div v-if="loading" class="vk-skeleton" aria-busy="true">
      <div v-for="n in 3" :key="n" class="vk-skeleton-col">
        <div class="skeleton vk-skeleton-header" />
        <div class="skeleton vk-skeleton-card" v-for="m in 3" :key="m" />
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="groups.length === 0"
      class="vk-empty"
      role="status"
    >
      <i class="pi pi-objects-column vk-empty-icon" aria-hidden="true" />
      <h3 class="vk-empty-heading">No data to display</h3>
      <p class="vk-empty-text">
        Add records with a status or category field to see them organized here.
      </p>
    </div>

    <!-- Kanban columns -->
    <div v-else class="vk-board">
      <div
        v-for="group in groups"
        :key="group.key"
        class="vk-column"
        role="list"
        :aria-label="`${group.label} column`"
      >
        <!-- Column header -->
        <div class="vk-column-header">
          <div class="vk-column-title-group">
            <span
              v-if="group.color"
              class="vk-column-dot"
              :style="{ backgroundColor: group.color }"
              aria-hidden="true"
            />
            <h3 class="vk-column-title">{{ group.label }}</h3>
          </div>
          <span class="vk-column-count">{{ group.items.length }}</span>
        </div>

        <!-- Cards -->
        <div class="vk-cards">
          <div
            v-for="item in group.items"
            :key="getItemId(item)"
            class="vk-card"
            role="listitem"
            tabindex="0"
            :aria-label="getItemTitle(item)"
            draggable="true"
            @click="handleCardClick(item)"
            @keydown.enter="handleCardClick(item)"
            @dragstart="handleDragStart($event, item, group.key)"
            @dragend="handleDragEnd"
          >
            <div class="vk-card-title">{{ getItemTitle(item) }}</div>
            <div v-if="getItemSubtitle(item)" class="vk-card-subtitle">
              {{ getItemSubtitle(item) }}
            </div>
          </div>

          <!-- Empty column state -->
          <div v-if="group.items.length === 0" class="vk-column-empty">
            <i class="pi pi-inbox vk-column-empty-icon" aria-hidden="true" />
            <span>No items</span>
          </div>
        </div>

        <!-- Drop zone -->
        <div
          :class="[
            'vk-drop-zone',
            dragOverGroup === group.key ? 'vk-drop-zone--active' : '',
          ]"
          @dragover.prevent="dragOverGroup = group.key"
          @dragleave="dragOverGroup = null"
          @drop.prevent="handleDrop(group.key)"
        >
          <span v-if="dragOverGroup === group.key" class="vk-drop-zone-label">
            Drop here
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

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

<style scoped>
.vk-root {
  font-family: var(--font-body);
}

/* Skeleton loading */
.vk-skeleton {
  display: flex;
  gap: var(--space-4);
}

.vk-skeleton-col {
  flex: 1;
  min-width: 250px;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.vk-skeleton-header {
  width: 100%;
  height: 2rem;
  margin-bottom: var(--space-1);
}

.vk-skeleton-card {
  width: 100%;
  height: 5rem;
}

/* Empty state */
.vk-empty {
  text-align: center;
  padding: var(--space-16) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.vk-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-4);
}

.vk-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.vk-empty-text {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  max-width: 28rem;
  margin-left: auto;
  margin-right: auto;
  line-height: var(--leading-relaxed);
}

/* Board */
.vk-board {
  display: flex;
  gap: var(--space-4);
  overflow-x: auto;
  padding-bottom: var(--space-4);
  scrollbar-width: thin;
  scrollbar-color: var(--surface-300) transparent;
}

/* Column */
.vk-column {
  flex-shrink: 0;
  width: 18rem;
  background: var(--surface-50);
  border-radius: var(--radius-xl);
  padding: var(--space-3);
  border: var(--border-thin) solid var(--surface-100);
}

/* Column header */
.vk-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
  padding: 0 var(--space-1);
}

.vk-column-title-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.vk-column-dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.vk-column-title {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-wide);
  margin: 0;
}

.vk-column-count {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  background: var(--surface-200);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
}

/* Cards */
.vk-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.vk-card {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  box-shadow: var(--shadow-xs);
  border: var(--border-thin) solid var(--surface-100);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-default);
  border-left: var(--border-thick) solid transparent;
}

.vk-card:hover {
  box-shadow: var(--shadow-md);
  border-left-color: var(--accent-400);
  transform: translateY(-1px);
}

.vk-card:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

.vk-card:active {
  transform: scale(0.98);
  box-shadow: var(--shadow-sm);
}

.vk-card-title {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
  line-height: var(--leading-snug);
}

.vk-card-subtitle {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: var(--leading-normal);
}

/* Empty column */
.vk-column-empty {
  text-align: center;
  padding: var(--space-6) var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-xs);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.vk-column-empty-icon {
  font-size: var(--text-xl);
  opacity: 0.3;
}

/* Drop zone */
.vk-drop-zone {
  margin-top: var(--space-2);
  border-radius: var(--radius-lg);
  border: var(--border-medium) dashed transparent;
  padding: var(--space-2);
  transition: all var(--duration-normal) var(--ease-default);
  text-align: center;
  min-height: var(--space-6);
}

.vk-drop-zone--active {
  border-color: var(--accent-400);
  background: var(--accent-50);
}

.vk-drop-zone-label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--accent-600);
  letter-spacing: var(--tracking-wide);
}
</style>
