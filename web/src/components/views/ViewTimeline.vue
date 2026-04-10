<template>
  <div class="vtl-root" role="region" aria-label="Timeline view">
    <!-- Loading skeleton -->
    <div v-if="loading" class="vtl-skeleton" aria-busy="true">
      <div class="skeleton vtl-skeleton-header" />
      <div class="skeleton vtl-skeleton-card" v-for="n in 4" :key="n" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="groupedEvents.length === 0"
      class="vtl-empty"
      role="status"
    >
      <i class="pi pi-calendar vtl-empty-icon" aria-hidden="true" />
      <h3 class="vtl-empty-heading">No events to display</h3>
      <p class="vtl-empty-text">
        Create events with date fields to see them on the timeline.
      </p>
    </div>

    <!-- Timeline content -->
    <div v-else class="vtl-timeline">
      <!-- Date group -->
      <div v-for="group in groupedEvents" :key="group.dateKey" class="vtl-group">
        <div class="vtl-group-header">
          <div class="vtl-group-icon" aria-hidden="true">
            <i class="pi pi-calendar" />
          </div>
          <div class="vtl-group-meta">
            <h3 class="vtl-group-date">{{ group.dateLabel }}</h3>
            <span class="vtl-group-count">
              {{ group.events.length }} {{ group.events.length === 1 ? 'event' : 'events' }}
            </span>
          </div>
        </div>

        <!-- Events for this date -->
        <div class="vtl-events">
          <div
            v-for="event in group.events"
            :key="getEventId(event)"
            class="vtl-event"
            role="button"
            tabindex="0"
            :aria-label="getEventTitle(event)"
            @click="handleEventClick(event)"
            @keydown.enter="handleEventClick(event)"
          >
            <!-- Timeline dot -->
            <div class="vtl-event-dot" aria-hidden="true" />

            <div class="vtl-event-content">
              <div class="vtl-event-body">
                <div class="vtl-event-title">{{ getEventTitle(event) }}</div>
                <div v-if="getEventDescription(event)" class="vtl-event-desc">
                  {{ getEventDescription(event) }}
                </div>
              </div>
              <div v-if="getEventTime(event)" class="vtl-event-time">
                <i class="pi pi-clock" aria-hidden="true" />
                {{ getEventTime(event) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

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
  'event-click': [record: Record<string, unknown>]
}>()

interface TimelineGroup {
  dateKey: string
  dateLabel: string
  events: Record<string, unknown>[]
}

const dateField = computed(() => props.config.dateField ?? 'date')

const groupedEvents = computed<TimelineGroup[]>(() => {
  const field = dateField.value
  const groups = new Map<string, Record<string, unknown>[]>()

  // Sort records by date
  const sorted = [...props.data].sort((a, b) => {
    const dateA = String(a[field] ?? '')
    const dateB = String(b[field] ?? '')
    return dateA.localeCompare(dateB)
  })

  for (const record of sorted) {
    const rawDate = record[field]
    if (!rawDate) continue

    const dateKey = String(rawDate).slice(0, 10) // YYYY-MM-DD
    const existing = groups.get(dateKey)
    if (existing) {
      existing.push(record)
    } else {
      groups.set(dateKey, [record])
    }
  }

  return Array.from(groups.entries()).map(([dateKey, events]) => ({
    dateKey,
    dateLabel: formatDateLabel(dateKey),
    events,
  }))
})

function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function getEventId(event: Record<string, unknown>): string {
  return String(event.id ?? event.eventId ?? Math.random())
}

function getEventTitle(event: Record<string, unknown>): string {
  return String(event.name ?? event.title ?? event.activity ?? event.label ?? 'Untitled event')
}

function getEventDescription(event: Record<string, unknown>): string | null {
  const value = event.description ?? event.subtitle ?? null
  return value ? String(value) : null
}

function getEventTime(event: Record<string, unknown>): string | null {
  const start = event.startTime ?? event.time
  if (!start) return null

  const end = event.endTime
  if (end) return `${start} — ${end}`
  return String(start)
}

function handleEventClick(event: Record<string, unknown>): void {
  emit('event-click', event)
}
</script>

<style scoped>
.vtl-root {
  font-family: var(--font-body);
}

/* Skeleton */
.vtl-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.vtl-skeleton-header {
  width: 100%;
  height: 3rem;
}

.vtl-skeleton-card {
  width: 100%;
  height: 4rem;
}

/* Empty state */
.vtl-empty {
  text-align: center;
  padding: var(--space-16) var(--space-8);
  border: var(--border-medium) dashed var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--surface-50);
}

.vtl-empty-icon {
  font-size: var(--text-4xl);
  color: var(--text-muted);
  opacity: 0.35;
  display: block;
  margin-bottom: var(--space-4);
}

.vtl-empty-heading {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.vtl-empty-text {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
  line-height: var(--leading-relaxed);
}

/* Timeline */
.vtl-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

/* Group */
.vtl-group-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.vtl-group-icon {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-full);
  background: var(--primary-100);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.vtl-group-icon .pi {
  font-size: var(--text-sm);
  color: var(--primary-600);
}

.vtl-group-date {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin: 0;
  letter-spacing: var(--tracking-wide);
}

.vtl-group-count {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* Events */
.vtl-events {
  margin-left: 1.25rem;
  border-left: var(--border-medium) solid var(--surface-200);
  padding-left: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.vtl-event {
  position: relative;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-xs);
  border: var(--border-thin) solid var(--surface-100);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-default);
  border-left: var(--border-thick) solid transparent;
}

.vtl-event:hover {
  box-shadow: var(--shadow-md);
  border-left-color: var(--accent-400);
  transform: translateX(2px);
}

.vtl-event:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}

/* Timeline dot */
.vtl-event-dot {
  position: absolute;
  left: calc(-1 * var(--space-6) - 1.5px - 0.375rem);
  top: 1.25rem;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: var(--radius-full);
  background: var(--primary-500);
  border: 2px solid var(--bg-card);
  box-shadow: 0 0 0 2px var(--surface-200);
}

/* Event content */
.vtl-event-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.vtl-event-body {
  min-width: 0;
  flex: 1;
}

.vtl-event-title {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  line-height: var(--leading-snug);
}

.vtl-event-desc {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: var(--space-1);
  line-height: var(--leading-normal);
}

.vtl-event-time {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}

.vtl-event-time .pi {
  font-size: 0.625rem;
}
</style>
