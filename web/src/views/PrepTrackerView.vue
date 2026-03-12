<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">Prep Tracker</h1>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        severity="secondary"
        size="small"
        :loading="loading"
        @click="loadData"
      />
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card class="border-l-4 border-accent-400">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">Total Items</div>
          <div class="font-display text-3xl font-extrabold text-surface-900 mt-1">{{ summary.total }}</div>
        </template>
      </Card>
      <Card class="border-l-4 border-emerald-400">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">Complete</div>
          <div class="font-display text-3xl font-extrabold text-emerald-600 mt-1">{{ summary.complete }}</div>
        </template>
      </Card>
      <Card class="border-l-4 border-amber-400">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">Remaining</div>
          <div class="font-display text-3xl font-extrabold text-amber-600 mt-1">{{ summary.incomplete }}</div>
        </template>
      </Card>
      <Card class="border-l-4 border-red-400">
        <template #content>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500">Overdue</div>
          <div
            class="font-display text-3xl font-extrabold mt-1"
            :class="summary.overdue > 0 ? 'text-red-600' : 'text-surface-900'"
          >
            {{ summary.overdue }}
          </div>
        </template>
      </Card>
    </div>

    <!-- Progress bar -->
    <Card>
      <template #content>
        <div class="flex items-center gap-4">
          <ProgressBar :value="progressPercent" class="flex-1" />
          <span class="text-sm font-medium whitespace-nowrap">{{ progressPercent }}% complete</span>
        </div>
      </template>
    </Card>

    <!-- Filters -->
    <div class="flex flex-wrap gap-3">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText
          v-model="searchQuery"
          placeholder="Search items..."
          class="w-56"
        />
      </IconField>
      <Select
        v-model="filterStatus"
        :options="statusOptions"
        placeholder="All Statuses"
        showClear
        class="w-40"
      />
      <Select
        v-model="filterGuest"
        :options="guestOptions"
        placeholder="All Guests"
        showClear
        class="w-48"
      />
      <Select
        v-model="filterOwner"
        :options="ownerOptions"
        placeholder="Filter by Owner"
        showClear
        class="w-48"
      />
    </div>

    <!-- Prep items list -->
    <Card>
      <template #content>
        <div v-if="loading" class="flex justify-center py-8">
          <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="4" />
        </div>
        <div v-else-if="filteredItems.length === 0" class="text-center py-8 text-surface-400">
          No prep items found. Items are generated when guests are created.
        </div>
        <div v-else class="divide-y divide-surface-100">
          <div
            v-for="item in filteredItems"
            :key="item.id"
            class="flex items-center gap-3 py-3"
          >
            <Checkbox
              :modelValue="item.status === 'Complete'"
              :binary="true"
              @update:modelValue="toggleItem(item)"
            />
            <div class="flex-1 min-w-0">
              <div
                :class="[
                  'text-sm',
                  item.status === 'Complete' ? 'line-through text-surface-400' : 'text-surface-800',
                ]"
              >
                {{ item.label }}
              </div>
              <div class="text-xs text-surface-400 mt-0.5">
                {{ item.guestName }} &middot; {{ item.owner }} &middot; Due: {{ item.dueDate || 'N/A' }}
              </div>
            </div>
            <Tag
              :value="item.status"
              :severity="getStatusSeverity(item.status)"
              rounded
            />
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import ProgressSpinner from 'primevue/progressspinner'
import Tag from 'primevue/tag'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import { api } from '@/api/client'
import type { PrepItem, WriteResult } from '@/types'

const toast = useToast()

const loading = ref(false)
const items = ref<PrepItem[]>([])
const searchQuery = ref('')
const filterStatus = ref<string | null>(null)
const filterGuest = ref<string | null>(null)
const filterOwner = ref<string | null>(null)

const statusOptions = ['Complete', 'Incomplete', 'Overdue']

const guestOptions = computed<string[]>(() => {
  const names = new Set(items.value.map((i) => i.guestName))
  return Array.from(names).sort()
})

const ownerOptions = computed<string[]>(() => {
  const owners = new Set(items.value.map((i) => i.owner))
  return Array.from(owners).sort()
})

const filteredItems = computed<PrepItem[]>(() => {
  return items.value.filter((item) => {
    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      const matchesQuery =
        item.label.toLowerCase().includes(query) ||
        item.guestName.toLowerCase().includes(query) ||
        item.owner.toLowerCase().includes(query)
      if (!matchesQuery) return false
    }
    if (filterStatus.value && item.status !== filterStatus.value) return false
    if (filterGuest.value && item.guestName !== filterGuest.value) return false
    if (filterOwner.value && item.owner !== filterOwner.value) return false
    return true
  })
})

const summary = computed(() => {
  const total = items.value.length
  const complete = items.value.filter((i) => i.status === 'Complete').length
  const overdue = items.value.filter((i) => i.status === 'Overdue').length
  return { total, complete, incomplete: total - complete, overdue }
})

const progressPercent = computed(() => {
  if (summary.value.total === 0) return 0
  return Math.round((summary.value.complete / summary.value.total) * 100)
})

function getStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'secondary' {
  const map: Record<string, 'success' | 'warn' | 'danger' | 'secondary'> = {
    Complete: 'success',
    Incomplete: 'warn',
    Overdue: 'danger',
  }
  return map[status] ?? 'secondary'
}

function toggleItem(item: PrepItem): void {
  const newStatus = item.status === 'Complete' ? 'Incomplete' : 'Complete'
  api.call<WriteResult>('updatePrepItem', {
    prepId: item.id,
    patch: {
      Status: newStatus,
      'Completed At': newStatus === 'Complete' ? new Date().toISOString() : '',
    },
  })
    .then(() => loadData())
    .catch((err: Error) => {
      toast.add({
        severity: 'error',
        summary: 'Update Failed',
        detail: 'Failed to update prep item: ' + err.message,
        life: 4000,
      })
    })
}

function loadData(): void {
  loading.value = true
  const filters: Record<string, string> = {}
  if (filterStatus.value) filters.status = filterStatus.value
  if (filterGuest.value) filters.guest = filterGuest.value

  api.call<PrepItem[]>('getPrepItems', { filters })
    .then((data) => {
      items.value = data
    })
    .catch((err: Error) => {
      toast.add({
        severity: 'error',
        summary: 'Load Failed',
        detail: 'Failed to load prep items: ' + err.message,
        life: 4000,
      })
    })
    .finally(() => {
      loading.value = false
    })
}

onMounted(loadData)
</script>
