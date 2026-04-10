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
        <div class="flex items-center gap-2">
          <span class="text-sm text-surface-500">
            {{ filteredGuests.length }} guest{{ filteredGuests.length !== 1 ? 's' : '' }}
          </span>
          <Button
            :icon="viewMode === 'table' ? 'pi pi-th-large' : 'pi pi-list'"
            :severity="'secondary'"
            text
            rounded
            :aria-label="viewMode === 'table' ? 'Switch to card view' : 'Switch to table view'"
            @click="toggleViewMode"
          />
        </div>
      </template>
    </Toolbar>

    <!-- Guest data table -->
    <DataTable
      v-if="viewMode === 'table'"
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

    <!-- Guest card grid -->
    <div v-if="viewMode === 'card'" class="guest-card-grid">
      <div v-if="loading" class="text-center py-8 text-surface-400">Loading...</div>
      <div v-else-if="filteredGuests.length === 0" class="text-center py-8 text-surface-400">
        No guests found
      </div>
      <template v-else>
        <div
          v-for="guest in filteredGuests"
          :key="guest.guestId"
          class="guest-card"
          tabindex="0"
          @click="openGuestFromCard(guest)"
          @keydown.enter="openGuestFromCard(guest)"
        >
          <div class="guest-card__header">
            <div
              class="guest-card__avatar"
              :style="{ backgroundColor: getDepartmentColor(guest.department) }"
            >
              {{ getInitials(guest.name) }}
            </div>
            <div class="guest-card__identity">
              <div class="guest-card__name">{{ guest.name }}</div>
              <div class="guest-card__company">{{ guest.company || '\u2014' }}</div>
            </div>
          </div>
          <div class="guest-card__badges">
            <Tag :value="guest.status" :severity="getStatusSeverity(guest.status)" rounded />
            <Tag :value="guest.type" severity="secondary" rounded />
          </div>
          <div class="guest-card__prep">
            <div class="guest-card__prep-label">
              <span class="text-xs text-surface-500">Prep</span>
              <span class="text-xs font-semibold text-surface-700">{{ guest.prepPercent }}%</span>
            </div>
            <ProgressBar :value="guest.prepPercent" style="height: 0.5rem" :showValue="false" />
          </div>
          <div class="guest-card__footer">
            <span class="text-xs text-surface-500">
              <i class="pi pi-users mr-1" />{{ guest.staffCount }} assigned
            </span>
            <span
              v-if="guest.interpreterRequired"
              class="text-xs text-surface-500"
            >
              <i class="pi pi-language mr-1" />Interpreter
            </span>
          </div>
        </div>
      </template>
    </div>
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
const viewMode = ref<'table' | 'card'>('table')

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

const departmentColorMap: Record<string, string> = {
  Anime: '#3b82f6',
  Gaming: '#10b981',
  Music: '#8b5cf6',
  Cosplay: '#ec4899',
  Panels: '#f59e0b',
  Artists: '#ef4444',
  Industry: '#6366f1',
}

function toggleViewMode(): void {
  viewMode.value = viewMode.value === 'table' ? 'card' : 'table'
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getDepartmentColor(department: string): string {
  return departmentColorMap[department] ?? '#94a3b8'
}

function openGuestFromCard(guest: GuestSummary): void {
  router.push({ name: 'guest-hub', params: { id: guest.guestId } })
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

<style scoped>
.guest-card-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

@media (min-width: 640px) {
  .guest-card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 1024px) {
  .guest-card-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.guest-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 0.75rem;
  background: var(--p-surface-0);
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.guest-card:hover {
  border-color: var(--p-primary-300);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.guest-card:focus-visible {
  outline: 2px solid var(--p-primary-500);
  outline-offset: 2px;
}

.guest-card__header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.guest-card__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  color: #fff;
  font-size: 0.875rem;
  font-weight: 600;
  flex-shrink: 0;
  letter-spacing: 0.025em;
}

.guest-card__identity {
  min-width: 0;
}

.guest-card__name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--p-surface-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.guest-card__company {
  font-size: 0.8125rem;
  color: var(--p-surface-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.guest-card__badges {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.guest-card__prep {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.guest-card__prep-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.guest-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 0.25rem;
  border-top: 1px solid var(--p-surface-100);
}
</style>
