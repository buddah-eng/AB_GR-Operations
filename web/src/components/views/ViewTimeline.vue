<template>
  <div class="view-timeline" role="region" aria-label="Timeline view">
    <!-- Loading state -->
    <div v-if="loading" class="space-y-4" aria-busy="true">
      <Skeleton width="100%" height="3rem" />
      <Skeleton v-for="n in 4" :key="n" width="100%" height="4rem" />
    </div>

    <!-- Empty state -->
    <Message
      v-else-if="groupedEvents.length === 0"
      severity="info"
      :closable="false"
    >
      No events to display on the timeline. Create events with date fields to
      see them here.
    </Message>

    <!-- Timeline content -->
    <div v-else class="space-y-6">
      <!-- Date group -->
      <div v-for="group in groupedEvents" :key="group.dateKey">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <i class="pi pi-calendar text-primary text-sm" />
          </div>
          <div>
            <h3 class="text-sm font-semibold text-surface-800">
              {{ group.dateLabel }}
            </h3>
            <span class="text-xs text-surface-400">
              {{ group.events.length }} {{ group.events.length === 1 ? 'event' : 'events' }}
            </span>
          </div>
        </div>

        <!-- Events for this date -->
        <div class="ml-5 border-l-2 border-surface-200 pl-6 space-y-3">
          <div
            v-for="event in group.events"
            :key="getEventId(event)"
            class="relative bg-white rounded-lg p-4 shadow-sm border border-surface-100
                   cursor-pointer hover:shadow-md hover:border-primary/30 transition-all duration-150"
            role="button"
            tabindex="0"
            :aria-label="getEventTitle(event)"
            @click="handleEventClick(event)"
            @keydown.enter="handleEventClick(event)"
          >
            <!-- Timeline dot -->
            <div class="absolute -left-[31px] top-5 w-3 h-3 rounded-full bg-primary border-2 border-white" />

            <div class="flex items-start justify-between">
              <div>
                <div class="text-sm font-medium text-surface-800">
                  {{ getEventTitle(event) }}
                </div>
                <div
                  v-if="getEventDescription(event)"
                  class="text-xs text-surface-500 mt-1"
                >
                  {{ getEventDescription(event) }}
                </div>
              </div>
              <div v-if="getEventTime(event)" class="text-xs text-surface-400 ml-4 whitespace-nowrap">
                <i class="pi pi-clock mr-1" />
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
