<template>
  <div class="space-y-6">
    <!-- ============================================================= -->
    <!--  HEADER                                                        -->
    <!-- ============================================================= -->
    <div class="flex items-center justify-between">
      <h1 class="page-title">Schedule</h1>
      <SelectButton
        v-model="viewMode"
        :options="viewModeOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        aria-label="View mode"
      />
    </div>

    <!-- ============================================================= -->
    <!--  DAY NAVIGATION                                                -->
    <!-- ============================================================= -->
    <div
      v-if="dayOptions.length > 0"
      class="flex flex-wrap items-center gap-2"
    >
      <button
        v-for="opt in dayOptions"
        :key="opt.value"
        :class="[
          'rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2',
          selectedDay === opt.value
            ? 'bg-accent-500 text-white shadow-sm'
            : 'bg-surface-100 text-surface-600 hover:bg-surface-200',
        ]"
        @click="selectedDay = opt.value"
      >
        {{ opt.label }}
      </button>
    </div>

    <!-- ============================================================= -->
    <!--  FILTERS TOOLBAR                                               -->
    <!-- ============================================================= -->
    <Toolbar>
      <template #start>
        <Select
          v-model="filterGuest"
          :options="guestNameOptions"
          placeholder="All Guests"
          showClear
          filter
          class="w-52 mr-2"
        />
        <Select
          v-model="filterVenue"
          :options="venueOptions"
          placeholder="All Venues"
          showClear
          class="w-48 mr-2"
        />
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          placeholder="All Statuses"
          showClear
          class="w-40"
        />
      </template>
      <template #end>
        <span class="text-sm text-surface-500">
          {{ filteredEvents.length }} event{{ filteredEvents.length !== 1 ? 's' : '' }}
        </span>
      </template>
    </Toolbar>

    <!-- ============================================================= -->
    <!--  TIMELINE VIEW                                                 -->
    <!-- ============================================================= -->
    <Card v-if="viewMode === 'timeline'">
      <template #content>
        <div
          v-if="timelineMappedEvents.length === 0"
          class="text-sm text-surface-400 text-center py-8"
        >
          No events to display on the timeline.
        </div>
        <div v-else class="relative overflow-x-auto">
          <!-- Hour labels -->
          <div class="flex border-b border-surface-200 pb-1 mb-3">
            <div
              v-for="hour in timelineHours"
              :key="hour"
              class="flex-1 text-center text-[10px] font-medium uppercase tracking-wider text-surface-400"
            >
              {{ formatHourLabel(hour) }}
            </div>
          </div>

          <!-- Timeline track -->
          <div class="relative min-h-[120px]">
            <!-- Hour grid lines -->
            <div
              v-for="hour in timelineHours"
              :key="'grid-' + hour"
              class="absolute top-0 bottom-0 w-px bg-surface-100"
              :style="{ left: ((hour - TIMELINE_START_HOUR) / (TIMELINE_END_HOUR - TIMELINE_START_HOUR)) * 100 + '%' }"
            />

            <!-- Current time indicator -->
            <div
              v-if="currentTimeOffset !== null"
              class="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
              :style="{ left: currentTimeOffset + '%' }"
            >
              <div class="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-500" />
            </div>

            <!-- Event rows -->
            <div
              v-for="(row, rowIdx) in timelineRows"
              :key="rowIdx"
              class="relative h-9 mb-1.5"
            >
              <div
                v-for="event in row"
                :key="event.eventId"
                :class="[
                  'absolute top-0 h-full rounded px-2 flex items-center gap-1 overflow-hidden cursor-pointer transition-opacity hover:opacity-80',
                  getEventBgClass(event.eventType),
                  event.hasConflict ? 'ring-2 ring-red-500 ring-offset-1' : '',
                ]"
                :style="{
                  left: event.leftPercent + '%',
                  width: Math.max(event.widthPercent, 2) + '%',
                }"
                :title="event.activity + ' — ' + event.guestName + ' (' + event.startTime + '–' + event.endTime + ')'"
                @click="openGuest(event.guestId)"
              >
                <span class="text-[10px] font-bold text-white truncate">
                  {{ event.guestName }}
                </span>
                <span
                  v-if="event.widthPercent > 8"
                  class="text-[9px] text-white/80 truncate hidden sm:inline"
                >
                  {{ event.activity }}
                </span>
              </div>
            </div>
          </div>

          <!-- Conflict callout -->
          <div
            v-if="conflictCount > 0"
            class="mt-4 flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2"
          >
            <i class="pi pi-exclamation-triangle text-red-500" />
            <span class="text-sm font-medium text-red-700">
              {{ conflictCount }} scheduling conflict{{ conflictCount !== 1 ? 's' : '' }} detected
            </span>
          </div>

          <!-- Legend -->
          <div class="flex flex-wrap gap-3 mt-4 pt-3 border-t border-surface-100">
            <span
              v-for="item in TIMELINE_LEGEND"
              :key="item.type"
              class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-surface-500"
            >
              <span :class="['w-2.5 h-2.5 rounded-sm', item.colorClass]" />
              {{ item.type }}
            </span>
            <span class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-surface-500">
              <span class="w-2.5 h-2.5 rounded-sm ring-2 ring-red-500 bg-surface-300" />
              Conflict
            </span>
          </div>
        </div>
      </template>
    </Card>

    <!-- ============================================================= -->
    <!--  TABLE VIEW                                                    -->
    <!-- ============================================================= -->
    <DataTable
      v-if="viewMode === 'table'"
      :value="filteredEvents"
      :loading="loading"
      :paginator="filteredEvents.length > 25"
      :rows="25"
      :rowsPerPageOptions="[10, 25, 50]"
      sortMode="single"
      removableSort
      stripedRows
      :rowHover="true"
      class="cursor-pointer"
      @row-click="onRowClick"
      tableStyle="min-width: 60rem"
    >
      <template #empty>
        <div class="text-center py-8 text-surface-400">No events found</div>
      </template>

      <Column field="date" header="Date" sortable style="min-width: 7rem" />
      <Column field="startTime" header="Start" style="min-width: 5rem" />
      <Column field="endTime" header="End" style="min-width: 5rem" />
      <Column field="activity" header="Activity" sortable style="min-width: 10rem" />
      <Column field="eventType" header="Type" sortable style="min-width: 7rem">
        <template #body="{ data: row }">
          <Tag
            :value="row.eventType"
            :style="{ backgroundColor: getEventHexColor(row.eventType), color: '#fff' }"
            rounded
          />
        </template>
      </Column>
      <Column field="guestName" header="Guest" sortable style="min-width: 10rem" />
      <Column field="venue" header="Venue" sortable style="min-width: 8rem" />
      <Column field="status" header="Status" sortable style="min-width: 7rem">
        <template #body="{ data: row }">
          <Tag :value="row.status" :severity="getStatusSeverity(row.status)" rounded />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import DataTable, { type DataTableRowClickEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import Toolbar from 'primevue/toolbar'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import { useAppStore } from '@/stores/app'
import { api } from '@/api/client'
import type { ScheduleEvent } from '@/types'

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

interface TimelineMappedEvent {
  eventId: string
  activity: string
  eventType: string
  guestId: string
  guestName: string
  startTime: string
  endTime: string
  startMinute: number
  endMinute: number
  leftPercent: number
  widthPercent: number
  hasConflict: boolean
}

interface LegendItem {
  type: string
  colorClass: string
}

interface DayOption {
  label: string
  value: string
}

interface ViewModeOption {
  label: string
  value: 'table' | 'timeline'
}

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const TIMELINE_START_HOUR = 8
const TIMELINE_END_HOUR = 22
const TIMELINE_TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60

const ALL_DAYS_KEY = '__all__'

const timelineHours: readonly number[] = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
  (_, i) => TIMELINE_START_HOUR + i,
)

const TIMELINE_LEGEND: readonly LegendItem[] = [
  { type: 'Panel', colorClass: 'bg-indigo-500' },
  { type: 'Autograph', colorClass: 'bg-purple-500' },
  { type: 'Meal', colorClass: 'bg-emerald-500' },
  { type: 'Photo Op', colorClass: 'bg-sky-500' },
  { type: 'Other', colorClass: 'bg-amber-500' },
]

const EVENT_BG_MAP: Readonly<Record<string, string>> = {
  Panel: 'bg-indigo-500',
  Autograph: 'bg-purple-500',
  'Autograph Session': 'bg-purple-500',
  Meal: 'bg-emerald-500',
  'Photo Op': 'bg-sky-500',
  Photoshoot: 'bg-sky-500',
}

const EVENT_HEX_MAP: Readonly<Record<string, string>> = {
  Panel: '#6366f1',
  Autograph: '#a855f7',
  'Autograph Session': '#a855f7',
  Meal: '#10b981',
  'Photo Op': '#0ea5e9',
  Photoshoot: '#0ea5e9',
}

const statusOptions = ['Scheduled', 'Confirmed', 'Cancelled'] as string[]

const viewModeOptions = [
  { label: 'Table', value: 'table' },
  { label: 'Timeline', value: 'timeline' },
] as ViewModeOption[]

/* ================================================================== */
/*  State                                                              */
/* ================================================================== */

const router = useRouter()
const toast = useToast()
const appStore = useAppStore()

const events = ref<ScheduleEvent[]>([])
const loading = ref(false)
const viewMode = ref<'table' | 'timeline'>('timeline')
const selectedDay = ref<string>(ALL_DAYS_KEY)
const filterGuest = ref<string | null>(null)
const filterVenue = ref<string | null>(null)
const filterStatus = ref<string | null>(null)
const now = ref(new Date())
let clockInterval: ReturnType<typeof setInterval> | null = null

/* ================================================================== */
/*  Computed: Filter options derived from events                       */
/* ================================================================== */

const dayOptions = computed((): readonly DayOption[] => {
  const dates = [...new Set(events.value.map((e) => e.date).filter(Boolean))].sort()
  if (dates.length === 0) return []
  return [
    { label: 'All Days', value: ALL_DAYS_KEY },
    ...dates.map((d) => ({ label: formatDayLabel(d), value: d })),
  ]
})

const guestNameOptions = computed((): string[] =>
  [...new Set(events.value.map((e) => e.guestName).filter(Boolean))].sort(),
)

const venueOptions = computed((): string[] => {
  const fromConfig = (appStore.config?.venues ?? [])
    .map((v) => (v['Venue Name'] as string) || (v['venue_name'] as string) || '')
    .filter(Boolean)
  const fromEvents = events.value.map((e) => e.venue).filter(Boolean)
  return [...new Set([...fromConfig, ...fromEvents])].sort()
})

/* ================================================================== */
/*  Computed: Filtered events                                          */
/* ================================================================== */

const filteredEvents = computed((): readonly ScheduleEvent[] =>
  events.value.filter((e) => {
    if (selectedDay.value !== ALL_DAYS_KEY && e.date !== selectedDay.value) return false
    if (filterGuest.value && e.guestName !== filterGuest.value) return false
    if (filterVenue.value && e.venue !== filterVenue.value) return false
    if (filterStatus.value && e.status !== filterStatus.value) return false
    return true
  }),
)

/* ================================================================== */
/*  Computed: Conflict detection                                       */
/* ================================================================== */

const conflictEventIds = computed((): ReadonlySet<string> => {
  const ids = new Set<string>()
  const byGuest = groupByGuest(filteredEvents.value)

  for (const guestEvents of Object.values(byGuest)) {
    if (guestEvents.length < 2) continue
    const sorted = [...guestEvents].sort((a, b) => {
      const aMin = parseTimeToMinutes(a.startTime)
      const bMin = parseTimeToMinutes(b.startTime)
      return (aMin ?? 0) - (bMin ?? 0)
    })
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const aStart = parseTimeToMinutes(sorted[i].startTime)
        const aEnd = parseTimeToMinutes(sorted[i].endTime)
        const bStart = parseTimeToMinutes(sorted[j].startTime)
        if (aStart === null || aEnd === null || bStart === null) continue
        if (bStart < aEnd) {
          ids.add(sorted[i].eventId)
          ids.add(sorted[j].eventId)
        }
      }
    }
  }

  return ids
})

const conflictCount = computed((): number => conflictEventIds.value.size)

/* ================================================================== */
/*  Computed: Timeline mapping                                         */
/* ================================================================== */

const timelineMappedEvents = computed((): readonly TimelineMappedEvent[] =>
  filteredEvents.value
    .map((e) => mapToTimeline(e, conflictEventIds.value))
    .filter((mapped): mapped is TimelineMappedEvent => mapped !== null),
)

const timelineRows = computed((): readonly (readonly TimelineMappedEvent[])[] => {
  const sorted = [...timelineMappedEvents.value].sort(
    (a, b) => a.startMinute - b.startMinute,
  )
  const rows: TimelineMappedEvent[][] = []
  for (const ev of sorted) {
    const fittingRowIdx = rows.findIndex((row) =>
      row.every(
        (placed) =>
          placed.endMinute <= ev.startMinute || ev.endMinute <= placed.startMinute,
      ),
    )
    if (fittingRowIdx >= 0) {
      rows[fittingRowIdx] = [...rows[fittingRowIdx], ev]
    } else {
      rows.push([ev])
    }
  }
  return rows
})

const currentTimeOffset = computed((): number | null => {
  const d = now.value
  const currentMinutes = d.getHours() * 60 + d.getMinutes()
  const offset = currentMinutes - TIMELINE_START_HOUR * 60
  if (offset < 0 || offset > TIMELINE_TOTAL_MINUTES) return null
  return (offset / TIMELINE_TOTAL_MINUTES) * 100
})

/* ================================================================== */
/*  Helpers: Time parsing                                              */
/* ================================================================== */

function parseTimeToMinutes(time: string): number | null {
  if (!time) return null
  const amPmMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (amPmMatch) {
    let hours = Number(amPmMatch[1])
    const minutes = Number(amPmMatch[2])
    const period = amPmMatch[3].toUpperCase()
    if (period === 'PM' && hours < 12) hours = hours + 12
    if (period === 'AM' && hours === 12) hours = 0
    return hours * 60 + minutes
  }
  const match24 = time.match(/^(\d{1,2}):(\d{2})$/)
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2])
  }
  const numeric = Number(time)
  if (!isNaN(numeric) && numeric >= 0 && numeric < 1440) {
    return numeric
  }
  return null
}

/* ================================================================== */
/*  Helpers: Timeline mapping                                          */
/* ================================================================== */

function mapToTimeline(
  ev: ScheduleEvent,
  conflicts: ReadonlySet<string>,
): TimelineMappedEvent | null {
  const startMinute = parseTimeToMinutes(ev.startTime)
  const endMinute = parseTimeToMinutes(ev.endTime)
  if (startMinute === null || endMinute === null) return null

  const offsetStart = startMinute - TIMELINE_START_HOUR * 60
  const offsetEnd = endMinute - TIMELINE_START_HOUR * 60
  const leftPercent = Math.max(0, (offsetStart / TIMELINE_TOTAL_MINUTES) * 100)
  const widthPercent = Math.max(0, ((offsetEnd - offsetStart) / TIMELINE_TOTAL_MINUTES) * 100)

  return {
    eventId: ev.eventId,
    activity: ev.activity,
    eventType: ev.eventType,
    guestId: ev.guestId,
    guestName: ev.guestName,
    startTime: ev.startTime,
    endTime: ev.endTime,
    startMinute,
    endMinute,
    leftPercent,
    widthPercent,
    hasConflict: conflicts.has(ev.eventId),
  }
}

function groupByGuest(
  items: readonly ScheduleEvent[],
): Readonly<Record<string, readonly ScheduleEvent[]>> {
  const result: Record<string, ScheduleEvent[]> = {}
  for (const item of items) {
    const key = item.guestId || item.guestName
    if (!key) continue
    result[key] = [...(result[key] ?? []), item]
  }
  return result
}

/* ================================================================== */
/*  Helpers: Display formatting                                        */
/* ================================================================== */

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 12) return hour === 0 ? '12am' : '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

function formatDayLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T12:00:00')
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function getEventBgClass(eventType: string): string {
  return EVENT_BG_MAP[eventType] ?? 'bg-amber-500'
}

function getEventHexColor(eventType: string): string {
  return EVENT_HEX_MAP[eventType] ?? '#f59e0b'
}

function getStatusSeverity(
  status: string,
): 'success' | 'info' | 'danger' | 'secondary' | 'warn' {
  const map: Readonly<Record<string, 'success' | 'info' | 'danger' | 'secondary' | 'warn'>> = {
    Scheduled: 'info',
    Confirmed: 'success',
    Cancelled: 'danger',
    Changed: 'warn',
  }
  return map[status] ?? 'secondary'
}

/* ================================================================== */
/*  Navigation                                                         */
/* ================================================================== */

function openGuest(guestId: string): void {
  if (guestId) {
    router.push({ name: 'guest-hub', params: { id: guestId } })
  }
}

function onRowClick(event: DataTableRowClickEvent): void {
  const row = event.data as ScheduleEvent
  openGuest(row.guestId)
}

/* ================================================================== */
/*  Data loading                                                       */
/* ================================================================== */

function loadData(): void {
  loading.value = true
  const filters: Record<string, string> = {}
  if (filterVenue.value) filters.venue = filterVenue.value
  if (filterStatus.value) filters.status = filterStatus.value

  api
    .call<ScheduleEvent[]>('getScheduleList', { filters })
    .then((data) => {
      events.value = data
    })
    .catch((err: Error) => {
      toast.add({
        severity: 'error',
        summary: 'Load Failed',
        detail: 'Failed to load schedule: ' + err.message,
        life: 4000,
      })
    })
    .finally(() => {
      loading.value = false
    })
}

/* ================================================================== */
/*  Lifecycle                                                          */
/* ================================================================== */

onMounted(() => {
  loadData()
  clockInterval = setInterval(() => {
    now.value = new Date()
  }, 60_000)
})

onUnmounted(() => {
  if (clockInterval !== null) {
    clearInterval(clockInterval)
  }
})
</script>
