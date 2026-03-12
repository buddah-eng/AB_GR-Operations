<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-surface-800">Guests</h1>
      <Button
        label="New Guest"
        icon="pi pi-plus"
        @click="router.push({ name: 'new-guest' })"
      />
    </div>

    <!-- Toolbar with search, filters, and needs-attention toggle -->
    <Toolbar>
      <template #start>
        <IconField class="mr-2">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            placeholder="Search guests..."
            class="w-56"
          />
        </IconField>
        <Select
          v-model="filterStatus"
          :options="statusOptions"
          placeholder="All Statuses"
          showClear
          class="w-40 mr-2"
          @change="loadData"
        />
        <Select
          v-model="filterDepartment"
          :options="departmentOptions"
          placeholder="All Departments"
          showClear
          class="w-48 mr-2"
          @change="loadData"
        />
        <Button
          :label="'Needs Attention'"
          :icon="needsAttention ? 'pi pi-exclamation-triangle' : 'pi pi-filter'"
          :severity="needsAttention ? 'danger' : 'secondary'"
          :badge="String(needsAttentionCount)"
          badgeSeverity="danger"
          :outlined="!needsAttention"
          @click="toggleNeedsAttention"
        />
      </template>
      <template #end>
        <span class="text-sm text-surface-500">
          {{ filteredGuests.length }} guest{{ filteredGuests.length !== 1 ? 's' : '' }}
        </span>
      </template>
    </Toolbar>

    <!-- Guest data table -->
    <DataTable
      :value="filteredGuests"
      :loading="loading"
      :paginator="filteredGuests.length > 25"
      :rows="25"
      :rowsPerPageOptions="[10, 25, 50]"
      sortMode="single"
      removableSort
      stripedRows
      :rowHover="true"
      class="cursor-pointer"
      @row-click="openGuest"
      tableStyle="min-width: 50rem"
    >
      <template #empty>
        <div class="text-center py-8 text-surface-400">No guests found</div>
      </template>

      <Column field="name" header="Name" sortable style="min-width: 12rem" />
      <Column field="type" header="Type" sortable style="min-width: 8rem" />
      <Column field="department" header="Department" sortable style="min-width: 8rem" />
      <Column field="status" header="Status" sortable style="min-width: 7rem">
        <template #body="{ data: row }">
          <Tag :value="row.status" :severity="getStatusSeverity(row.status)" rounded />
        </template>
      </Column>
      <Column field="staffCount" header="Staff" sortable style="min-width: 5rem" />
      <!-- TODO: GuestSummary lacks a `liaison` field — using staffCount as fallback until the API provides liaison data -->
      <Column field="staffCount" header="Liaison" sortable style="min-width: 6rem">
        <template #body="{ data: row }">
          <span class="text-surface-500">{{ row.staffCount }} assigned</span>
        </template>
      </Column>
      <Column field="prepPercent" header="Prep" sortable style="min-width: 10rem">
        <template #body="{ data: row }">
          <div class="flex items-center gap-2">
            <ProgressBar :value="row.prepPercent" style="width: 4rem; height: 0.5rem" :showValue="false" />
            <span class="text-xs text-surface-500">{{ row.prepPercent }}%</span>
          </div>
        </template>
      </Column>
      <Column field="company" header="Company" sortable style="min-width: 8rem" />
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import DataTable, { type DataTableRowClickEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Toolbar from 'primevue/toolbar'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import ProgressBar from 'primevue/progressbar'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import { useAppStore } from '@/stores/app'
import { api } from '@/api/client'
import type { GuestSummary } from '@/types'

const router = useRouter()
const toast = useToast()
const appStore = useAppStore()

const guests = ref<GuestSummary[]>([])
const loading = ref(false)
const filterStatus = ref<string | null>(null)
const filterDepartment = ref<string | null>(null)
const searchQuery = ref('')
const needsAttention = ref(false)

const statusOptions = ['Confirmed', 'Invited', 'Cancelled']

const departmentOptions = computed<string[]>(() => {
  if (!appStore.config) return []
  return appStore.config.departments
    .map((d) => (d['Department Name'] as string) || (d['department_name'] as string) || '')
    .filter(Boolean)
})

function guestNeedsAttention(guest: GuestSummary): boolean {
  return guest.prepPercent < 50 || guest.staffCount === 0
}

const needsAttentionCount = computed<number>(() =>
  guests.value.filter(guestNeedsAttention).length
)

function matchesSearch(guest: GuestSummary, query: string): boolean {
  if (!query) return true
  const lowerQuery = query.toLowerCase()
  return (
    guest.name.toLowerCase().includes(lowerQuery) ||
    guest.company.toLowerCase().includes(lowerQuery) ||
    guest.department.toLowerCase().includes(lowerQuery)
  )
}

const filteredGuests = computed<GuestSummary[]>(() => {
  return guests.value.filter((guest) => {
    if (!matchesSearch(guest, searchQuery.value)) return false
    if (needsAttention.value && !guestNeedsAttention(guest)) return false
    if (filterStatus.value && guest.status !== filterStatus.value) return false
    if (filterDepartment.value && guest.department !== filterDepartment.value) return false
    return true
  })
})

function toggleNeedsAttention(): void {
  needsAttention.value = !needsAttention.value
}

function getStatusSeverity(status: string): 'success' | 'info' | 'danger' | 'secondary' {
  const map: Record<string, 'success' | 'info' | 'danger' | 'secondary'> = {
    Confirmed: 'success',
    Invited: 'info',
    Cancelled: 'danger',
  }
  return map[status] ?? 'secondary'
}

function loadData(): void {
  loading.value = true
  const filters: Record<string, string> = {}
  if (filterStatus.value) filters.status = filterStatus.value
  if (filterDepartment.value) filters.department = filterDepartment.value

  api.call<GuestSummary[]>('getGuestList', { filters })
    .then((data) => {
      guests.value = data
    })
    .catch((err: Error) => {
      toast.add({
        severity: 'error',
        summary: 'Load Failed',
        detail: 'Failed to load guests: ' + err.message,
        life: 4000,
      })
    })
    .finally(() => {
      loading.value = false
    })
}

function openGuest(event: DataTableRowClickEvent): void {
  const row = event.data as GuestSummary
  router.push({ name: 'guest-hub', params: { id: row.guestId } })
}

onMounted(loadData)
</script>
