<template>
  <div class="space-y-6">
    <!-- Loading -->
    <div v-if="loading && !guest" class="flex items-center justify-center h-64">
      <ProgressSpinner style="width: 40px; height: 40px" strokeWidth="4" />
    </div>

    <template v-if="guest">
      <!-- Guest header -->
      <Card>
        <template #content>
          <div class="flex items-start justify-between">
            <div>
              <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">{{ guest['Guest Name'] }}</h1>
              <div class="flex flex-wrap items-center gap-3 mt-2 text-sm text-surface-500">
                <Tag :value="String(guest.Status ?? '')" :severity="statusSeverity" rounded />
                <span>{{ guest.Department }}</span>
                <span v-if="guest['Guest Type']">{{ guest['Guest Type'] }}</span>
                <span v-if="guest['Company/Affiliation']">{{ guest['Company/Affiliation'] }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <!-- Outputs -->
              <div class="flex gap-1">
                <Button
                  label="Generate Itinerary"
                  icon="pi pi-file-pdf"
                  severity="secondary"
                  size="small"
                  :loading="saving"
                  @click="generateItinerary"
                />
                <Button
                  label="Liaison Checklist"
                  icon="pi pi-list-check"
                  severity="secondary"
                  size="small"
                  :loading="saving"
                  @click="generateChecklist"
                />
              </div>
              <Button
                label="Back to List"
                icon="pi pi-arrow-left"
                severity="secondary"
                size="small"
                @click="router.push({ name: 'guests' })"
              />
            </div>
          </div>
        </template>
      </Card>

      <!-- Tab views -->
      <TabView v-model:activeIndex="activeTabIndex">
        <!-- INFO TAB -->
        <TabPanel header="Info" value="0">
          <div class="flex justify-end mb-4">
            <Button
              v-if="!editing"
              label="Edit"
              icon="pi pi-pencil"
              severity="secondary"
              size="small"
              @click="startEditing"
            />
            <div v-else class="flex gap-2">
              <Button
                label="Save"
                icon="pi pi-check"
                size="small"
                :loading="saving"
                @click="saveGuest"
              />
              <Button
                label="Cancel"
                icon="pi pi-times"
                severity="secondary"
                size="small"
                @click="cancelEditing"
              />
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-surface-700">Guest Name</label>
              <InputText v-model="editForm['Guest Name']" :disabled="!editing" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-surface-700">Guest Type</label>
              <Select
                v-model="editForm['Guest Type']"
                :options="guestTypeOptions"
                :disabled="!editing"
                placeholder="Select type"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-surface-700">Department</label>
              <Select
                v-model="editForm['Department']"
                :options="deptOptions"
                :disabled="!editing"
                placeholder="Select department"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-surface-700">Status</label>
              <Select
                v-model="editForm['Status']"
                :options="['Invited', 'Confirmed', 'Cancelled']"
                :disabled="!editing"
                placeholder="Select status"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-surface-700">Company/Affiliation</label>
              <InputText v-model="editForm['Company/Affiliation']" :disabled="!editing" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-surface-700">Interpreter Required</label>
              <Select
                v-model="editForm['Interpreter Required']"
                :options="['Yes', 'No']"
                :disabled="!editing"
                placeholder="Select"
              />
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium text-surface-700">Research Links</label>
              <Textarea v-model="editForm['Research Links']" :disabled="!editing" rows="3" />
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium text-surface-700">Special Handling Notes</label>
              <Textarea v-model="editForm['Special Handling Notes']" :disabled="!editing" rows="3" />
            </div>
          </div>
        </TabPanel>

        <GuestDetailTabs
          :schedule="tabData.schedule"
          :travel="tabData.travel"
          :accommodations="tabData.accommodations"
          :dietary="tabData.dietary"
          :autographs="tabData.autographs"
          :event-type-options="eventTypeOptions"
          :venue-options="venueOptions"
          :saving="saving"
          @add-event="handleAddEvent"
          @add-travel="handleAddTravel"
        />

        <!-- PREP TRACKER TAB -->
        <TabPanel :header="'Prep (' + tabData.prepTracker.length + ')'" value="6">
          <div v-if="tabData.prepTracker.length === 0" class="text-center py-6">
            <p class="text-surface-400 mb-4">
              No prep items. Click below to generate from templates.
            </p>
            <Button
              label="Generate Prep Checklist"
              icon="pi pi-list-check"
              size="small"
              :loading="saving"
              @click="generatePrepItems"
            />
          </div>
          <div v-else class="divide-y divide-surface-100">
            <div
              v-for="item in tabData.prepTracker"
              :key="String(item['Prep ID'] ?? item['prep_id'] ?? '')"
              class="flex items-center gap-3 py-3"
            >
              <Checkbox
                :modelValue="isPrepComplete(item)"
                :binary="true"
                @update:modelValue="togglePrepItem(item)"
              />
              <div class="flex-1">
                <span
                  :class="isPrepComplete(item)
                    ? 'line-through text-surface-400'
                    : 'text-surface-800'"
                >
                  {{ item.Item || item.item }}
                </span>
                <span class="ml-2 text-xs text-surface-400">
                  Due: {{ item['Due Date'] || 'N/A' }}
                </span>
              </div>
              <Tag
                :value="getPrepStatus(item)"
                :severity="getPrepSeverity(item)"
                rounded
              />
            </div>
          </div>
        </TabPanel>

        <!-- STAFF TAB -->
        <TabPanel :header="'Staff (' + tabData.pairings.length + ')'" value="7">
          <div class="flex justify-end mb-4">
            <Button
              :label="showAddPairing ? 'Cancel' : 'Assign Staff'"
              :icon="showAddPairing ? 'pi pi-times' : 'pi pi-plus'"
              size="small"
              @click="showAddPairing = !showAddPairing"
            />
          </div>
          <Card v-if="showAddPairing" class="mb-4">
            <template #content>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium">Role *</label>
                  <Select v-model="newPairing.Role" :options="roleOptions" placeholder="Select role" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium">Staff Member *</label>
                  <Select v-model="newPairing['Staff ID']" :options="staffSelectOptions" optionLabel="label" optionValue="value" placeholder="Select staff" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium">Notes</label>
                  <InputText v-model="newPairing.Notes" />
                </div>
              </div>
              <Button label="Assign" icon="pi pi-check" size="small" class="mt-3" :loading="saving" @click="addPairing" />
            </template>
          </Card>
          <div v-if="tabData.pairings.length === 0" class="text-center py-6 text-surface-400">
            No staff assigned
          </div>
          <div v-else class="divide-y divide-surface-100">
            <div
              v-for="p in typedPairings"
              :key="p.pairingId"
              class="flex items-center justify-between py-3"
            >
              <div>
                <span class="font-medium">{{ p.staffName || p.staffId }}</span>
                <span class="ml-2 text-sm text-surface-500">{{ p.staffEmail }}</span>
              </div>
              <div class="flex items-center gap-3">
                <Tag :value="p.role" severity="info" rounded />
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  severity="danger"
                  size="small"
                  aria-label="Remove pairing"
                  @click="removePairing(p)"
                />
              </div>
            </div>
          </div>
        </TabPanel>
      </TabView>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import Button from 'primevue/button'
import TabView from 'primevue/tabview'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Checkbox from 'primevue/checkbox'
import ProgressSpinner from 'primevue/progressspinner'
import { useAppStore } from '@/stores/app'
import { api } from '@/api/client'
import type { GuestDetail, WriteResult } from '@/types'
import GuestDetailTabs from '@/views/GuestDetailTabs.vue'

/* ---- Interfaces ---- */

interface PairingRecord {
  pairingId: string
  staffName?: string
  staffId?: string
  staffEmail?: string
  role: string
  rowVersion?: number
  [key: string]: unknown
}

interface PrepItem {
  'Prep ID'?: string
  prep_id?: string
  Item?: string
  item?: string
  Status?: string
  status?: string
  'Due Date'?: string
  'Completed At'?: string
  row_version?: number
  [key: string]: unknown
}

/* ---- Composables & stores ---- */

const router = useRouter()
const route = useRoute()
const toast = useToast()
const appStore = useAppStore()

/* ---- State ---- */

const loading = ref(false)
const savingCount = ref(0)
const editing = ref(false)
const activeTabIndex = ref(0)
const guest = ref<Record<string, unknown> | null>(null)
const tabData = reactive<{
  schedule: Record<string, unknown>[]
  travel: Record<string, unknown>[]
  accommodations: Record<string, unknown>[]
  dietary: Record<string, unknown>[]
  autographs: Record<string, unknown>[]
  prepTracker: PrepItem[]
  pairings: PairingRecord[]
  violations: Record<string, unknown>[]
}>({
  schedule: [],
  travel: [],
  accommodations: [],
  dietary: [],
  autographs: [],
  prepTracker: [],
  pairings: [],
  violations: [],
})
const editForm = reactive<Record<string, string>>({})
const showAddPairing = ref(false)
const newPairing = reactive<Record<string, string>>({
  Role: '', 'Staff ID': '', Notes: '',
})

/* ---- Config-derived options ---- */

const guestTypeOptions = ['Industry Guest', 'Musical Guest', 'Voice Actor', 'Artist', 'Creator']

const deptOptions = computed<string[]>(() =>
  (appStore.config?.departments ?? [])
    .map((d) => (d['Department Name'] as string) || (d['department_name'] as string) || '')
    .filter(Boolean),
)
const eventTypeOptions = computed<string[]>(() =>
  (appStore.config?.eventTypes ?? [])
    .map((t) => (t['Type Name'] as string) || (t['type_name'] as string) || '')
    .filter(Boolean),
)
const venueOptions = computed<string[]>(() =>
  (appStore.config?.venues ?? [])
    .map((v) => (v['Venue Name'] as string) || (v['venue_name'] as string) || '')
    .filter(Boolean),
)
const roleOptions = computed<string[]>(() =>
  (appStore.config?.roles ?? [])
    .map((r) => (r['Role Name'] as string) || (r['role_name'] as string) || '')
    .filter(Boolean),
)

const staffList = ref<Record<string, unknown>[]>([])
const staffSelectOptions = computed(() =>
  staffList.value.map((s) => ({
    value: String(s['Staff ID'] || s.staffId || ''),
    label: String(s['Staff Name'] || s.name || s['Staff ID'] || ''),
  })),
)

const typedPairings = computed<PairingRecord[]>(() => tabData.pairings)
const saving = computed(() => savingCount.value > 0)

const statusSeverity = computed<'success' | 'info' | 'danger' | 'secondary'>(() => {
  const s = String(guest.value?.Status ?? '').toLowerCase()
  const map: Record<string, 'success' | 'info' | 'danger' | 'secondary'> = {
    confirmed: 'success',
    invited: 'info',
    cancelled: 'danger',
  }
  return map[s] ?? 'secondary'
})

/* ---- Editable fields ---- */

const EDITABLE_FIELDS = [
  'Guest Name', 'Guest Type', 'Department', 'Status',
  'Company/Affiliation', 'Interpreter Required',
  'Research Links', 'Special Handling Notes',
]

function copyEditableFields(source: Record<string, unknown>): void {
  for (const key of EDITABLE_FIELDS) {
    editForm[key] = String(source[key] ?? '')
  }
}

/* ---- Data loading ---- */

function loadData(): void {
  const guestId = route.params.id as string | undefined
  if (!guestId) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'No guest ID provided', life: 4000 })
    return
  }

  loading.value = true
  api.call<GuestDetail>('getGuestDetail', { guestId })
    .then((result) => {
      guest.value = result.guest as Record<string, unknown>
      tabData.schedule = (result.schedule || []) as Record<string, unknown>[]
      tabData.travel = (result.travel || []) as Record<string, unknown>[]
      tabData.accommodations = (result.accommodations || []) as Record<string, unknown>[]
      tabData.dietary = (result.dietary || []) as Record<string, unknown>[]
      tabData.autographs = (result.autographs || []) as Record<string, unknown>[]
      tabData.prepTracker = (result.prepTracker || []) as PrepItem[]
      tabData.pairings = (result.pairings || []) as PairingRecord[]
      tabData.violations = (result.violations || []) as Record<string, unknown>[]
      copyEditableFields(result.guest as Record<string, unknown>)
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Load Failed', detail: err.message, life: 4000 })
    })
    .finally(() => {
      loading.value = false
    })
}

function loadStaffList(): void {
  api.call<Record<string, unknown>[]>('getStaffList')
    .then((result) => {
      staffList.value = Array.isArray(result) ? result : []
    })
    .catch(() => {
      // Non-critical
    })
}

/* ---- Editing ---- */

function startEditing(): void {
  if (!guest.value) return
  editing.value = true
  copyEditableFields(guest.value)
}

function cancelEditing(): void {
  editing.value = false
  if (guest.value) copyEditableFields(guest.value)
}

function saveGuest(): void {
  if (!guest.value) return
  savingCount.value++
  const guestId = String(guest.value['Guest ID'])
  const version = Number(guest.value.row_version) || 0
  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE_FIELDS) {
    patch[key] = editForm[key]
  }

  api.call<WriteResult>('updateGuest', { guestId, patch, rowVersion: version })
    .then((result) => {
      if (result.status === 'APPLIED' || result.status === 'NOOP') {
        toast.add({ severity: 'success', summary: 'Saved', detail: 'Guest updated', life: 3000 })
        editing.value = false
        loadData()
      } else if (result.status === 'VERSION_CONFLICT') {
        toast.add({ severity: 'warn', summary: 'Conflict', detail: 'Someone else edited this guest. Please refresh.', life: 5000 })
        loadData()
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: 'Update failed: ' + result.status, life: 4000 })
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      savingCount.value--
    })
}

/* ---- Schedule ---- */

function handleAddEvent(eventData: Record<string, string>): void {
  if (!guest.value) return
  if (!eventData.Activity || !eventData.Date) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Activity and Date are required', life: 3000 })
    return
  }
  savingCount.value++
  const data = { ...eventData, 'Guest ID': String(guest.value['Guest ID']) }
  api.call<WriteResult>('createScheduleEvent', { data })
    .then((result) => {
      if (result.status === 'APPLIED') {
        toast.add({ severity: 'success', summary: 'Created', detail: 'Event created', life: 3000 })
        loadData()
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: result.status, life: 4000 })
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      savingCount.value--
    })
}

/* ---- Travel ---- */

function handleAddTravel(travelData: Record<string, string>): void {
  if (!guest.value) return
  if (!travelData['Travel Type']) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Travel Type is required', life: 3000 })
    return
  }
  savingCount.value++
  const data = { ...travelData, 'Guest ID': String(guest.value['Guest ID']) }
  api.call<WriteResult>('createTravel', { data })
    .then((result) => {
      if (result.status === 'APPLIED') {
        toast.add({ severity: 'success', summary: 'Added', detail: 'Travel added', life: 3000 })
        loadData()
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: result.status, life: 4000 })
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      savingCount.value--
    })
}

/* ---- Staff pairings ---- */

function addPairing(): void {
  if (!guest.value) return
  if (!newPairing.Role || !newPairing['Staff ID']) {
    toast.add({ severity: 'warn', summary: 'Validation', detail: 'Role and Staff are required', life: 3000 })
    return
  }
  savingCount.value++
  const pairingData = { ...newPairing, 'Guest ID': String(guest.value['Guest ID']) }
  api.call<WriteResult>('createPairing', { data: pairingData })
    .then((result) => {
      if (result.status === 'APPLIED') {
        toast.add({ severity: 'success', summary: 'Assigned', detail: 'Staff assigned', life: 3000 })
        showAddPairing.value = false
        for (const k of Object.keys(newPairing)) {
          newPairing[k] = ''
        }
        loadData()
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: result.status, life: 4000 })
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      savingCount.value--
    })
}

function removePairing(p: PairingRecord): void {
  savingCount.value++
  api.call<WriteResult>('deletePairing', { pairingId: p.pairingId, rowVersion: p.rowVersion })
    .then((result) => {
      if (result.status === 'APPLIED') {
        toast.add({ severity: 'success', summary: 'Removed', detail: 'Staff removed', life: 3000 })
        loadData()
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: result.status, life: 4000 })
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      savingCount.value--
    })
}

/* ---- Prep tracker ---- */

function isPrepComplete(item: PrepItem): boolean {
  const s = String(item.Status || item.status || '').toLowerCase()
  return s === 'complete' || s === 'completed'
}

function getPrepStatus(item: PrepItem): string {
  if (isPrepComplete(item)) return 'Complete'
  const due = item['Due Date']
  if (due && new Date(due) < new Date()) return 'Overdue'
  return 'Incomplete'
}

function getPrepSeverity(item: PrepItem): 'success' | 'warn' | 'danger' {
  const s = getPrepStatus(item)
  if (s === 'Complete') return 'success'
  if (s === 'Overdue') return 'danger'
  return 'warn'
}

function togglePrepItem(item: PrepItem): void {
  const prepId = item['Prep ID'] || item.prep_id || ''
  const version = Number(item.row_version) || 0
  const newStatus = isPrepComplete(item) ? 'Incomplete' : 'Complete'
  const patch = {
    Status: newStatus,
    'Completed At': newStatus === 'Complete' ? new Date().toISOString() : '',
  }
  api.call<WriteResult>('updatePrepItem', { prepId, patch, rowVersion: version })
    .then((result) => {
      if (result.status === 'APPLIED') {
        loadData()
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: result.status, life: 4000 })
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
}

function generatePrepItems(): void {
  if (!guest.value) return
  savingCount.value++
  api.call<unknown>('createPrepItems', { guestId: String(guest.value['Guest ID']) })
    .then(() => {
      toast.add({ severity: 'success', summary: 'Generated', detail: 'Prep checklist generated', life: 3000 })
      loadData()
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      savingCount.value--
    })
}

/* ---- Output generation ---- */

function generateItinerary(): void {
  if (!guest.value) return
  const guestId = String(guest.value['Guest ID'])
  savingCount.value++
  api.call<{ url: string }>('generateItinerary', { guestId })
    .then((result) => {
      toast.add({ severity: 'success', summary: 'Generated', detail: 'Itinerary generated', life: 3000 })
      if (result.url) {
        window.open(result.url, '_blank')
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Failed', detail: err.message, life: 4000 })
    })
    .finally(() => { savingCount.value-- })
}

function generateChecklist(): void {
  if (!guest.value) return
  const guestId = String(guest.value['Guest ID'])
  savingCount.value++
  api.call<{ url: string }>('generateLiaisonChecklist', { guestId })
    .then((result) => {
      toast.add({ severity: 'success', summary: 'Generated', detail: 'Checklist generated', life: 3000 })
      if (result.url) {
        window.open(result.url, '_blank')
      }
    })
    .catch((err: Error) => {
      toast.add({ severity: 'error', summary: 'Failed', detail: err.message, life: 4000 })
    })
    .finally(() => { savingCount.value-- })
}

/* ---- Lifecycle ---- */

onMounted(() => {
  loadData()
  loadStaffList()
})
</script>
