<template>
  <div class="space-y-6">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <img :src="appStore.conventionLogoUrl" :alt="appStore.conventionName" class="w-8 h-8 rounded-lg object-cover shadow-sm" />
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          Dashboard
        </h1>
      </div>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        severity="secondary"
        size="small"
        :loading="loading"
        @click="loadData"
      />
    </div>

    <!-- ============================================================= -->
    <!--  1. ACTION REQUIRED BANNER                                     -->
    <!-- ============================================================= -->
    <div
      v-if="alerts.length > 0"
      class="rounded-lg border-l-4 border-accent-400 bg-accent-50 px-5 py-4"
    >
      <div class="flex items-center gap-2 mb-3">
        <i class="pi pi-exclamation-triangle text-accent-500 text-lg" />
        <h2 class="font-display text-lg font-semibold text-accent-600">
          Action Required
        </h2>
      </div>
      <ul class="space-y-2">
        <li
          v-for="alert in alerts"
          :key="alert.key"
          class="flex items-center gap-2"
        >
          <i class="pi pi-angle-right text-accent-500 text-sm" />
          <router-link
            :to="alert.to"
            class="text-sm font-medium text-accent-700 underline decoration-accent-300 underline-offset-2 hover:text-accent-900 hover:decoration-accent-500 transition-colors"
          >
            {{ alert.label }}
          </router-link>
        </li>
      </ul>
    </div>

    <!-- ============================================================= -->
    <!--  2. STAT CARDS ROW                                             -->
    <!-- ============================================================= -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Guests -->
      <Card class="border-l-4 border-l-primary-500">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">
            Total Guests
          </div>
          <div class="font-display text-3xl font-extrabold text-surface-900 mt-1">
            {{ guestTotal }}
          </div>
          <div class="flex gap-3 mt-2 text-xs text-surface-500">
            <span>
              <span class="font-semibold text-green-600">{{ guestConfirmed }}</span>
              confirmed
            </span>
            <span>
              <span class="font-semibold text-amber-600">{{ guestPending }}</span>
              pending
            </span>
          </div>
        </template>
      </Card>

      <!-- Liaison Coverage -->
      <Card class="border-l-4 border-l-primary-600">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">
            Liaison Coverage
          </div>
          <div class="font-display text-3xl font-extrabold text-surface-900 mt-1">
            {{ liaisonPercent }}%
          </div>
          <ProgressBar
            :value="liaisonPercent"
            :showValue="false"
            class="mt-2 h-2"
          />
        </template>
      </Card>

      <!-- Prep Complete -->
      <Card class="border-l-4 border-l-accent-400">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">
            Prep Complete
          </div>
          <div class="font-display text-3xl font-extrabold text-surface-900 mt-1">
            {{ prepPercent }}%
          </div>
          <ProgressBar
            :value="prepPercent"
            :showValue="false"
            class="mt-2 h-2"
          />
        </template>
      </Card>

      <!-- Schedule Conflicts -->
      <Card
        :class="[
          'border-l-4',
          scheduleConflicts > 0 ? 'border-l-red-500' : 'border-l-surface-300',
        ]"
      >
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">
            Schedule Conflicts
          </div>
          <div
            :class="[
              'font-display text-3xl font-extrabold mt-1',
              scheduleConflicts > 0 ? 'text-red-600' : 'text-surface-900',
            ]"
          >
            {{ scheduleConflicts }}
          </div>
          <div class="mt-2 text-xs text-surface-500">
            {{ scheduleConflicts > 0 ? 'Needs attention' : 'All clear' }}
          </div>
        </template>
      </Card>
    </div>

    <!-- ============================================================= -->
    <!--  3. STAFFING COVERAGE GRID                                     -->
    <!-- ============================================================= -->
    <div>
      <h2 class="font-display text-lg font-semibold text-surface-900 mb-3">
        Staffing Coverage
      </h2>
      <Card>
        <template #content>
          <div
            v-if="staffingRows.length === 0"
            class="text-sm text-surface-400 text-center py-6"
          >
            No unfilled staffing slots — all guests covered.
          </div>
          <div v-else class="divide-y divide-surface-100">
            <div
              v-for="row in staffingRows"
              :key="row.guestId"
              class="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <!-- Guest name -->
              <span class="flex-1 text-sm font-medium text-surface-800 truncate">
                {{ row.name }}
              </span>

              <!-- Liaison slot -->
              <span class="w-28 flex justify-center">
                <Tag
                  v-if="row.hasLiaison"
                  value="Liaison"
                  severity="success"
                  rounded
                />
                <Button
                  v-else
                  label="Assign"
                  icon="pi pi-user-plus"
                  severity="danger"
                  size="small"
                  text
                  class="text-xs"
                  @click="navigateToGuest(row.guestId)"
                />
              </span>

              <!-- Interpreter slot -->
              <span class="w-28 flex justify-center">
                <Tag
                  v-if="row.hasInterpreter"
                  value="Interpreter"
                  severity="success"
                  rounded
                />
                <Tag
                  v-else-if="row.needsInterpreter"
                  value="Needed"
                  severity="danger"
                  rounded
                />
                <Tag v-else value="N/A" severity="secondary" rounded />
              </span>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- ============================================================= -->
    <!--  4. TODAY'S TIMELINE PREVIEW                                    -->
    <!-- ============================================================= -->
    <div>
      <h2 class="font-display text-lg font-semibold text-surface-900 mb-3">
        Today's Schedule
      </h2>
      <Card>
        <template #content>
          <div
            v-if="timelineEvents.length === 0"
            class="text-sm text-surface-400 text-center py-6"
          >
            No events scheduled for today.
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
            <div class="relative h-auto min-h-[120px]">
              <!-- Current time indicator -->
              <div
                v-if="currentTimeOffset !== null"
                class="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                :style="{ left: currentTimeOffset + '%' }"
              >
                <div class="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-red-500" />
              </div>

              <!-- Event blocks -->
              <div
                v-for="(row, rowIdx) in timelineRows"
                :key="rowIdx"
                class="relative h-8 mb-1.5"
              >
                <div
                  v-for="event in row"
                  :key="event.eventId"
                  :class="[
                    'absolute top-0 h-full rounded px-1.5 flex items-center overflow-hidden cursor-pointer transition-opacity hover:opacity-80',
                    getEventColorClass(event.eventType),
                  ]"
                  :style="{
                    left: event.leftPercent + '%',
                    width: Math.max(event.widthPercent, 2) + '%',
                  }"
                  :title="event.activity + ' — ' + event.guestName"
                >
                  <span class="text-[10px] font-semibold text-white truncate">
                    {{ event.activity }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Legend -->
            <div class="flex flex-wrap gap-3 mt-4 pt-3 border-t border-surface-100">
              <span
                v-for="item in timelineLegend"
                :key="item.type"
                class="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-surface-500"
              >
                <span :class="['w-2.5 h-2.5 rounded-sm', item.colorClass]" />
                {{ item.type }}
              </span>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- ============================================================= -->
    <!--  5. BREAKDOWN CARDS (existing guests by status / events by type)-->
    <!-- ============================================================= -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card v-if="guestStatusEntries.length > 0">
        <template #title>
          <span class="font-display">Guests by Status</span>
        </template>
        <template #content>
          <div
            v-for="entry in guestStatusEntries"
            :key="entry.status"
            class="flex justify-between items-center py-2 border-b border-surface-50 last:border-0"
          >
            <Tag :value="entry.status" :severity="getGuestStatusSeverity(entry.status)" rounded />
            <span class="font-medium text-surface-800">{{ entry.count }}</span>
          </div>
        </template>
      </Card>

      <Card v-if="scheduleTypeEntries.length > 0">
        <template #title>
          <span class="font-display">Events by Type</span>
        </template>
        <template #content>
          <div
            v-for="entry in scheduleTypeEntries"
            :key="entry.type"
            class="flex justify-between items-center py-2 border-b border-surface-50 last:border-0"
          >
            <span class="text-sm text-surface-600">{{ entry.type }}</span>
            <span class="font-medium text-surface-800">{{ entry.count }}</span>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import Tag from 'primevue/tag'
import { api } from '@/api/client'
import { useAppStore } from '@/stores/app'
import type { DashboardData } from '@/types'

/* ---- Types ---- */

interface AlertItem {
  key: string
  label: string
  to: string
}

interface StaffingRow {
  guestId: string
  name: string
  hasLiaison: boolean
  needsInterpreter: boolean
  hasInterpreter: boolean
}

interface TimelineEvent {
  eventId: string
  activity: string
  eventType: string
  guestName: string
  startMinute: number
  endMinute: number
  leftPercent: number
  widthPercent: number
}

interface LegendItem {
  type: string
  colorClass: string
}

/* ---- State ---- */

const router = useRouter()
const toast = useToast()
const appStore = useAppStore()
const data = ref<DashboardData | null>(null)
const loading = ref(false)
const now = ref(new Date())
let clockInterval: ReturnType<typeof setInterval> | null = null

/* ---- Constants ---- */

const TIMELINE_START_HOUR = 8
const TIMELINE_END_HOUR = 22
const TIMELINE_TOTAL_MINUTES = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60

const timelineHours = Array.from(
  { length: TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1 },
  (_, i) => TIMELINE_START_HOUR + i,
)

const timelineLegend: readonly LegendItem[] = [
  { type: 'Panel', colorClass: 'bg-indigo-500' },
  { type: 'Autograph', colorClass: 'bg-purple-500' },
  { type: 'Meal', colorClass: 'bg-emerald-500' },
  { type: 'Photo Op', colorClass: 'bg-sky-500' },
  { type: 'Other', colorClass: 'bg-amber-500' },
]

const EVENT_COLOR_MAP: Readonly<Record<string, string>> = {
  Panel: 'bg-indigo-500',
  Autograph: 'bg-purple-500',
  'Autograph Session': 'bg-purple-500',
  Meal: 'bg-emerald-500',
  'Photo Op': 'bg-sky-500',
  Photoshoot: 'bg-sky-500',
}

/* ---- Safe accessors (no mutation) ---- */

function asNumber(obj: Record<string, unknown>, key: string): number {
  return Number(obj[key] ?? 0)
}

function nested(
  obj: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return obj?.[key] as Record<string, unknown> | undefined
}

function nestedArray(
  obj: Record<string, unknown> | undefined,
  key: string,
): readonly Record<string, unknown>[] {
  const val = obj?.[key]
  return Array.isArray(val) ? val : []
}

/* ---- Computed: Stat cards ---- */

const guestTotal = computed(() => asNumber(data.value?.guests ?? {}, 'total'))

const guestConfirmed = computed(() => {
  const byStatus = nested(data.value?.guests, 'byStatus')
  return Number(byStatus?.Confirmed ?? 0)
})

const guestPending = computed(() => {
  const byStatus = nested(data.value?.guests, 'byStatus')
  return Number(byStatus?.Invited ?? byStatus?.Pending ?? 0)
})

const liaisonPercent = computed(() => {
  const staffing = data.value?.staffing ?? {}
  const withLiaison = asNumber(staffing, 'guestsWithLiaison')
  const total = guestTotal.value
  if (total === 0) return 0
  return Math.round((withLiaison / total) * 100)
})

const prepPercent = computed(() => asNumber(data.value?.prep ?? {}, 'percentComplete'))

const scheduleConflicts = computed(() => {
  const violations = data.value?.violations ?? {}
  const byStatus = nested(violations, 'byStatus')
  return Number(byStatus?.Active ?? byStatus?.Open ?? 0)
})

/* ---- Computed: Action Required Alerts ---- */

const alerts = computed((): readonly AlertItem[] => {
  const items: AlertItem[] = []

  const guestsWithoutLiaison = guestTotal.value - asNumber(data.value?.staffing ?? {}, 'guestsWithLiaison')
  if (guestsWithoutLiaison > 0) {
    items.push({
      key: 'no-liaison',
      label: `${guestsWithoutLiaison} guest${guestsWithoutLiaison === 1 ? '' : 's'} without liaison`,
      to: '/guests',
    })
  }

  const overduePrep = asNumber(data.value?.prep ?? {}, 'overdue')
  if (overduePrep > 0) {
    items.push({
      key: 'prep-overdue',
      label: `${overduePrep} prep item${overduePrep === 1 ? '' : 's'} overdue`,
      to: '/prep-tracker',
    })
  }

  const convention = data.value?.schedule ?? {}
  const daysUntil = asNumber(convention, 'daysUntilConvention')
  const missingTravel = asNumber(data.value?.guests ?? {}, 'missingTravel')
  if (missingTravel > 0 || daysUntil > 0) {
    const travelCount = missingTravel > 0 ? missingTravel : guestTotal.value
    if (daysUntil > 0) {
      items.push({
        key: 'travel-missing',
        label: `Travel info incomplete — convention in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
        to: '/travel',
      })
    } else if (missingTravel > 0) {
      items.push({
        key: 'travel-missing',
        label: `${travelCount} guest${travelCount === 1 ? '' : 's'} missing travel info`,
        to: '/travel',
      })
    }
  }

  return items
})

/* ---- Computed: Staffing Coverage Grid ---- */

const staffingRows = computed((): readonly StaffingRow[] => {
  const pairings = nestedArray(data.value?.staffing, 'coverage')
  if (pairings.length === 0) {
    return buildPlaceholderStaffingRows()
  }
  return pairings
    .filter((p) => !p.hasLiaison || (p.interpreterRequired && !p.hasInterpreter))
    .slice(0, 6)
    .map((p) => ({
      guestId: String(p.guestId ?? ''),
      name: String(p.name ?? p.guestName ?? 'Unknown'),
      hasLiaison: Boolean(p.hasLiaison),
      needsInterpreter: Boolean(p.interpreterRequired),
      hasInterpreter: Boolean(p.hasInterpreter),
    }))
})

function buildPlaceholderStaffingRows(): readonly StaffingRow[] {
  const guestsWithLiaison = asNumber(data.value?.staffing ?? {}, 'guestsWithLiaison')
  const total = guestTotal.value
  const missing = total - guestsWithLiaison
  if (missing <= 0) return []
  return Array.from({ length: Math.min(missing, 6) }, (_, i) => ({
    guestId: '',
    name: `Guest ${i + 1} (data loading...)`,
    hasLiaison: false,
    needsInterpreter: false,
    hasInterpreter: false,
  }))
}

/* ---- Computed: Today's Timeline ---- */

const timelineEvents = computed((): readonly TimelineEvent[] => {
  const events = nestedArray(data.value?.schedule, 'todayEvents')
  if (events.length === 0) return []
  return events.map(mapScheduleEventToTimeline).filter(Boolean) as TimelineEvent[]
})

function mapScheduleEventToTimeline(
  ev: Record<string, unknown>,
): TimelineEvent | null {
  const startStr = String(ev.startTime ?? '')
  const endStr = String(ev.endTime ?? '')
  if (!startStr || !endStr) return null

  const startMinute = parseTimeToMinutes(startStr)
  const endMinute = parseTimeToMinutes(endStr)
  if (startMinute === null || endMinute === null) return null

  const offsetStart = startMinute - TIMELINE_START_HOUR * 60
  const offsetEnd = endMinute - TIMELINE_START_HOUR * 60
  const leftPercent = Math.max(0, (offsetStart / TIMELINE_TOTAL_MINUTES) * 100)
  const widthPercent = Math.max(0, ((offsetEnd - offsetStart) / TIMELINE_TOTAL_MINUTES) * 100)

  return {
    eventId: String(ev.eventId ?? ev.id ?? ''),
    activity: String(ev.activity ?? ev.name ?? ''),
    eventType: String(ev.eventType ?? ev.type ?? ''),
    guestName: String(ev.guestName ?? ''),
    startMinute,
    endMinute,
    leftPercent,
    widthPercent,
  }
}

function parseTimeToMinutes(time: string): number | null {
  // Handles "HH:MM", "H:MM AM/PM", or minutes-since-midnight
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

const timelineRows = computed((): readonly (readonly TimelineEvent[])[] => {
  const events = [...timelineEvents.value].sort(
    (a, b) => a.startMinute - b.startMinute,
  )
  const rows: TimelineEvent[][] = []
  for (const ev of events) {
    const existingRow = rows.find((row) =>
      row.every((placed) => placed.endMinute <= ev.startMinute || ev.endMinute <= placed.startMinute),
    )
    if (existingRow) {
      existingRow.push(ev)
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

/* ---- Computed: Breakdown cards ---- */

const guestStatusEntries = computed(() => {
  const byStatus = nested(data.value?.guests, 'byStatus')
  if (!byStatus) return []
  return Object.entries(byStatus).map(([status, count]) => ({
    status,
    count: Number(count),
  }))
})

const scheduleTypeEntries = computed(() => {
  const byType = nested(data.value?.schedule, 'byType')
  if (!byType) return []
  return Object.entries(byType).map(([type, count]) => ({
    type,
    count: Number(count),
  }))
})

/* ---- Helpers ---- */

function getEventColorClass(eventType: string): string {
  return EVENT_COLOR_MAP[eventType] ?? 'bg-amber-500'
}

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 12) return hour === 0 ? '12am' : '12pm'
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}

function getGuestStatusSeverity(status: string): 'success' | 'info' | 'danger' | 'secondary' {
  const map: Readonly<Record<string, 'success' | 'info' | 'danger' | 'secondary'>> = {
    Confirmed: 'success',
    Invited: 'info',
    Cancelled: 'danger',
  }
  return map[status] ?? 'secondary'
}

function navigateToGuest(guestId: string): void {
  if (guestId) {
    router.push({ name: 'guest-hub', params: { id: guestId } })
  }
}

/* ---- Data loading ---- */

function loadData(): void {
  loading.value = true
  api
    .call<DashboardData>('getDashboardData')
    .then((d) => {
      data.value = d
    })
    .catch((err: Error) => {
      toast.add({
        severity: 'error',
        summary: 'Load Failed',
        detail: 'Dashboard load failed: ' + err.message,
        life: 4000,
      })
    })
    .finally(() => {
      loading.value = false
    })
}

/* ---- Lifecycle ---- */

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
