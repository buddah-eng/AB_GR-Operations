import { ref, computed } from 'vue'
import type { GuestSummary, PrepItem, ScheduleEvent } from '@/types'

/* ------------------------------------------------------------------ */
/*  Demo time state — controls which temporal view of the data to show */
/* ------------------------------------------------------------------ */

export type DemoTimeState = 'pre-event' | 'during-event' | 'post-event'

const currentTimeState = ref<DemoTimeState>('pre-event')

/* ---- Status mappings per time state ---- */

const GUEST_STATUS_MAP: Record<DemoTimeState, Record<string, string>> = {
  'pre-event': {
    arrived: 'travel_arranged',
    attending: 'confirmed',
    departed: 'confirmed',
    archived: 'confirmed',
  },
  'during-event': {
    draft: 'draft',
    invited: 'invited',
    confirmed: 'attending',
    travel_arranged: 'arrived',
    arrived: 'attending',
    attending: 'attending',
    departed: 'attending',
    archived: 'attending',
  },
  'post-event': {
    draft: 'archived',
    invited: 'archived',
    confirmed: 'departed',
    travel_arranged: 'departed',
    arrived: 'departed',
    attending: 'departed',
    departed: 'departed',
    archived: 'archived',
  },
}

const PREP_COMPLETION_TARGETS: Record<DemoTimeState, number> = {
  'pre-event': 0.45,
  'during-event': 0.85,
  'post-event': 0.95,
}

const TRANSPORT_ACTIVE_MAP: Record<DemoTimeState, Record<string, string>> = {
  'pre-event': {
    confirmed: 'requested',
    completed: 'confirmed',
  },
  'during-event': {},
  'post-event': {
    confirmed: 'completed',
    pending: 'completed',
  },
}

/* ---- Public API ---- */

export function useDemoState() {
  const timeState = computed(() => currentTimeState.value)

  function setTimeState(state: DemoTimeState): void {
    currentTimeState.value = state
  }

  function adjustGuestStatus(guest: GuestSummary): GuestSummary {
    const statusMap = GUEST_STATUS_MAP[currentTimeState.value]
    const mappedStatus = statusMap[guest.status] ?? guest.status

    return {
      ...guest,
      status: mappedStatus,
    }
  }

  function adjustGuestStatuses(guests: GuestSummary[]): GuestSummary[] {
    return guests.map(adjustGuestStatus)
  }

  function adjustPrepItems(items: PrepItem[]): PrepItem[] {
    const target = PREP_COMPLETION_TARGETS[currentTimeState.value]

    if (target >= 1.0) {
      return items.map((item) => ({ ...item, status: 'complete' }))
    }

    const sorted = [...items].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate),
    )
    const completeCount = Math.floor(sorted.length * target)

    return sorted.map((item, index) => {
      if (index < completeCount) {
        return { ...item, status: 'complete' }
      }
      if (index < completeCount + 3) {
        return { ...item, status: 'in_progress' }
      }
      return { ...item, status: 'not_started' }
    })
  }

  function adjustTransportStatus(
    bookings: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const statusMap = TRANSPORT_ACTIVE_MAP[currentTimeState.value]

    return bookings.map((booking) => {
      const currentStatus = booking.status as string
      const mappedStatus = statusMap[currentStatus] ?? currentStatus

      // Pre-event: show vendor name instead of driver (drivers aren't assigned yet)
      if (currentTimeState.value === 'pre-event') {
        const vendor = (booking.vendor as string) ?? 'Transport vendor TBD'
        return { ...booking, status: mappedStatus, driver: vendor }
      }

      return { ...booking, status: mappedStatus }
    })
  }

  function adjustScheduleEvents(events: ScheduleEvent[]): ScheduleEvent[] {
    if (currentTimeState.value === 'post-event') {
      return events.map((event) => ({
        ...event,
        status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
      }))
    }
    return events
  }

  return {
    timeState,
    setTimeState,
    adjustGuestStatus,
    adjustGuestStatuses,
    adjustPrepItems,
    adjustTransportStatus,
    adjustScheduleEvents,
  }
}
