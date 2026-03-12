<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
        Settings
      </h1>
    </div>

    <Tabs :value="activeTab" @update:value="onTabChange">
      <TabList>
        <Tab value="convention">Convention</Tab>
        <Tab value="departments">Departments</Tab>
        <Tab value="roles">Roles</Tab>
        <Tab value="event-types">Event Types</Tab>
        <Tab value="venues">Venues</Tab>
        <Tab value="users">Users</Tab>
      </TabList>

      <TabPanels>
        <!-- TAB 1: Convention Config -->
        <TabPanel value="convention">
          <div class="space-y-6 pt-4">
            <!-- Countdown banner -->
            <div
              v-if="daysUntilConvention !== null"
              class="rounded-lg border-l-4 border-accent-500 bg-accent-50 px-5 py-4"
            >
              <div class="flex items-center gap-3">
                <i class="pi pi-calendar text-accent-600 text-xl" />
                <div>
                  <span class="font-display text-lg font-bold text-accent-800">
                    {{ daysUntilConvention }}
                  </span>
                  <span class="text-sm text-accent-700 ml-1.5">
                    day{{ daysUntilConvention === 1 ? '' : 's' }} until
                    {{ conventionForm.name || 'convention' }}
                  </span>
                </div>
              </div>
            </div>

            <Card>
              <template #title>
                <span class="font-display">Convention Details</span>
              </template>
              <template #content>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      Convention Name
                    </label>
                    <InputText v-model="conventionForm.name" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      Venue
                    </label>
                    <InputText v-model="conventionForm.venue" />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      Start Date
                    </label>
                    <InputText
                      v-model="conventionForm.startDate"
                      type="date"
                    />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      End Date
                    </label>
                    <InputText
                      v-model="conventionForm.endDate"
                      type="date"
                    />
                  </div>
                </div>
                <div class="mt-5">
                  <Button
                    label="Save Convention Config"
                    icon="pi pi-save"
                    @click="saveConventionConfig"
                  />
                </div>
              </template>
            </Card>
          </div>
        </TabPanel>

        <!-- TAB 2: Departments -->
        <TabPanel value="departments">
          <SettingsListEditor
            :items="departments"
            field-key="Department Name"
            field-header="Department Name"
            item-label="Department"
            placeholder="e.g. Marketing"
            @add="onAddDepartment"
            @delete="onDeleteDepartment"
          />
        </TabPanel>

        <!-- TAB 3: Roles -->
        <TabPanel value="roles">
          <SettingsListEditor
            :items="roles"
            field-key="Role Name"
            field-header="Role Name"
            item-label="Role"
            placeholder="e.g. Green Room Attendant"
            @add="onAddRole"
            @delete="onDeleteRole"
          />
        </TabPanel>

        <!-- TAB 4: Event Types -->
        <TabPanel value="event-types">
          <SettingsListEditor
            :items="eventTypes"
            field-key="Type Name"
            field-header="Type Name"
            item-label="Event Type"
            placeholder="e.g. Workshop"
            @add="onAddEventType"
            @delete="onDeleteEventType"
          />
        </TabPanel>

        <!-- TAB 5: Venues -->
        <TabPanel value="venues">
          <div class="space-y-5 pt-4">
            <Card>
              <template #title>
                <span class="font-display">Add Venue</span>
              </template>
              <template #content>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      Venue Name
                    </label>
                    <InputText
                      v-model="venueForm.name"
                      placeholder="e.g. Main Stage"
                    />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      Type
                    </label>
                    <Select
                      v-model="venueForm.type"
                      :options="venueTypeOptions"
                      placeholder="Select type"
                    />
                  </div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium text-surface-700">
                      Capacity
                    </label>
                    <InputNumber
                      v-model="venueForm.capacity"
                      :min="0"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div class="mt-4">
                  <Button
                    label="Add Venue"
                    icon="pi pi-plus"
                    @click="addVenue"
                  />
                </div>
              </template>
            </Card>

            <DataTable
              :value="venues"
              stripedRows
              tableStyle="min-width: 40rem"
            >
              <template #empty>
                <div class="text-center py-8 text-surface-400">
                  No venues configured
                </div>
              </template>
              <Column field="Venue Name" header="Venue Name" sortable />
              <Column field="Venue Type" header="Type" sortable>
                <template #body="{ data: row }">
                  <Tag
                    v-if="row['Venue Type']"
                    :value="String(row['Venue Type'])"
                    :severity="getVenueTypeSeverity(String(row['Venue Type']))"
                    rounded
                  />
                </template>
              </Column>
              <Column field="Capacity" header="Capacity" sortable>
                <template #body="{ data: row }">
                  <span v-if="row['Capacity']">
                    {{ Number(row['Capacity']).toLocaleString() }}
                  </span>
                  <span v-else class="text-surface-400">&mdash;</span>
                </template>
              </Column>
              <Column
                header="Actions"
                style="width: 8rem"
                :exportable="false"
              >
                <template #body="{ index }">
                  <Button
                    icon="pi pi-trash"
                    severity="danger"
                    text
                    rounded
                    aria-label="Delete venue"
                    @click="confirmDeleteVenue($event, index)"
                  />
                </template>
              </Column>
            </DataTable>
          </div>
        </TabPanel>

        <!-- TAB 6: User Management (placeholder) -->
        <TabPanel value="users">
          <Card class="mt-4">
            <template #content>
              <div class="text-center py-12">
                <i class="pi pi-users text-5xl text-surface-300 mb-4" />
                <h2
                  class="font-display text-lg font-semibold text-surface-700 mb-2"
                >
                  User Management
                </h2>
                <p class="text-sm text-surface-400 max-w-md mx-auto mb-6">
                  User management requires Firebase Admin SDK integration.
                  Users are managed via Firebase Console.
                </p>
                <a
                  href="https://console.firebase.google.com/project/_/authentication/users"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-2 text-sm font-medium text-accent-600 hover:text-accent-700 transition-colors"
                >
                  <i class="pi pi-external-link" />
                  Open Firebase Console
                </a>
              </div>
            </template>
          </Card>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <ConfirmPopup />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import ConfirmPopup from 'primevue/confirmpopup'
import { useAppStore } from '@/stores/app'
import SettingsListEditor from '@/components/SettingsListEditor.vue'

/* ------------------------------------------------------------------ */
/*  Store & services                                                   */
/* ------------------------------------------------------------------ */

const toast = useToast()
const confirm = useConfirm()
const appStore = useAppStore()

const activeTab = ref<string>('convention')

function onTabChange(value: string | number): void {
  activeTab.value = String(value)
}

/* ------------------------------------------------------------------ */
/*  Convention Config (Tab 1)                                          */
/* ------------------------------------------------------------------ */

interface ConventionForm {
  name: string
  startDate: string
  endDate: string
  venue: string
}

const conventionForm = ref<ConventionForm>({
  name: '',
  startDate: '',
  endDate: '',
  venue: '',
})

function initConventionForm(): void {
  const conv = appStore.config?.convention ?? {}
  conventionForm.value = {
    name: String(conv.name ?? ''),
    startDate: String(conv.startDate ?? ''),
    endDate: String(conv.endDate ?? ''),
    venue: String(conv.venue ?? ''),
  }
}

const daysUntilConvention = computed((): number | null => {
  const start = conventionForm.value.startDate
  if (!start) return null
  const startDate = new Date(start + 'T00:00:00')
  if (isNaN(startDate.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.ceil(
    (startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )
  return diff > 0 ? diff : null
})

async function saveConventionConfig(): Promise<void> {
  const form = conventionForm.value
  if (!form.name.trim()) {
    toast.add({
      severity: 'warn',
      summary: 'Validation',
      detail: 'Convention name is required',
      life: 3000,
    })
    return
  }

  appStore.config = {
    ...appStore.config,
    convention: {
      name: form.name.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      venue: form.venue.trim(),
    },
  }

  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'success' : 'warn',
    summary: saved ? 'Saved' : 'Local Only',
    detail: saved
      ? 'Convention config saved'
      : 'Saved locally — backend unavailable',
    life: 3000,
  })
}

/* ------------------------------------------------------------------ */
/*  Departments (Tab 2)                                                */
/* ------------------------------------------------------------------ */

const departments = computed(() => appStore.config?.departments ?? [])

async function onAddDepartment(name: string): Promise<void> {
  appStore.config = {
    ...appStore.config,
    departments: [...departments.value, { 'Department Name': name }],
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'success' : 'warn',
    summary: saved ? 'Added' : 'Added (Local Only)',
    detail: `Department "${name}" added`,
    life: 3000,
  })
}

async function onDeleteDepartment(index: number): Promise<void> {
  const name = String(departments.value[index]?.['Department Name'] ?? '')
  appStore.config = {
    ...appStore.config,
    departments: departments.value.filter((_, i) => i !== index),
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'info' : 'warn',
    summary: saved ? 'Deleted' : 'Deleted (Local Only)',
    detail: `Department "${name}" removed`,
    life: 3000,
  })
}

/* ------------------------------------------------------------------ */
/*  Roles (Tab 3)                                                      */
/* ------------------------------------------------------------------ */

const roles = computed(() => appStore.config?.roles ?? [])

async function onAddRole(name: string): Promise<void> {
  appStore.config = {
    ...appStore.config,
    roles: [...roles.value, { 'Role Name': name }],
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'success' : 'warn',
    summary: saved ? 'Added' : 'Added (Local Only)',
    detail: `Role "${name}" added`,
    life: 3000,
  })
}

async function onDeleteRole(index: number): Promise<void> {
  const name = String(roles.value[index]?.['Role Name'] ?? '')
  appStore.config = {
    ...appStore.config,
    roles: roles.value.filter((_, i) => i !== index),
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'info' : 'warn',
    summary: saved ? 'Deleted' : 'Deleted (Local Only)',
    detail: `Role "${name}" removed`,
    life: 3000,
  })
}

/* ------------------------------------------------------------------ */
/*  Event Types (Tab 4)                                                */
/* ------------------------------------------------------------------ */

const eventTypes = computed(() => appStore.config?.eventTypes ?? [])

async function onAddEventType(name: string): Promise<void> {
  appStore.config = {
    ...appStore.config,
    eventTypes: [...eventTypes.value, { 'Type Name': name }],
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'success' : 'warn',
    summary: saved ? 'Added' : 'Added (Local Only)',
    detail: `Event type "${name}" added`,
    life: 3000,
  })
}

async function onDeleteEventType(index: number): Promise<void> {
  const name = String(eventTypes.value[index]?.['Type Name'] ?? '')
  appStore.config = {
    ...appStore.config,
    eventTypes: eventTypes.value.filter((_, i) => i !== index),
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'info' : 'warn',
    summary: saved ? 'Deleted' : 'Deleted (Local Only)',
    detail: `Event type "${name}" removed`,
    life: 3000,
  })
}

/* ------------------------------------------------------------------ */
/*  Venues (Tab 5)                                                     */
/* ------------------------------------------------------------------ */

const venueTypeOptions: string[] = [
  'Hall',
  'Room',
  'Restaurant',
  'Outdoor',
  'Other',
]

interface VenueForm {
  name: string
  type: string | null
  capacity: number | null
}

const venueForm = ref<VenueForm>({
  name: '',
  type: null,
  capacity: null,
})

const venues = computed(() => appStore.config?.venues ?? [])

async function addVenue(): Promise<void> {
  const form = venueForm.value
  if (!form.name.trim()) {
    toast.add({
      severity: 'warn',
      summary: 'Validation',
      detail: 'Venue name is required',
      life: 3000,
    })
    return
  }

  const exists = venues.value.some(
    (v) =>
      String(v['Venue Name']).toLowerCase() ===
      form.name.trim().toLowerCase(),
  )
  if (exists) {
    toast.add({
      severity: 'warn',
      summary: 'Duplicate',
      detail: 'This venue already exists',
      life: 3000,
    })
    return
  }

  const newVenue: Record<string, unknown> = {
    'Venue Name': form.name.trim(),
  }
  if (form.type) {
    newVenue['Venue Type'] = form.type
  }
  if (form.capacity !== null && form.capacity > 0) {
    newVenue['Capacity'] = form.capacity
  }

  appStore.config = {
    ...appStore.config,
    venues: [...venues.value, newVenue],
  }
  venueForm.value = { name: '', type: null, capacity: null }

  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'success' : 'warn',
    summary: saved ? 'Added' : 'Added (Local Only)',
    detail: `Venue "${String(newVenue['Venue Name'])}" added`,
    life: 3000,
  })
}

function confirmDeleteVenue(event: Event, index: number): void {
  const name = String(venues.value[index]?.['Venue Name'] ?? '')
  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: `Delete venue "${name}"?`,
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => deleteVenue(index),
  })
}

async function deleteVenue(index: number): Promise<void> {
  const name = String(venues.value[index]?.['Venue Name'] ?? '')
  appStore.config = {
    ...appStore.config,
    venues: venues.value.filter((_, i) => i !== index),
  }
  const saved = await appStore.saveConfig()
  toast.add({
    severity: saved ? 'info' : 'warn',
    summary: saved ? 'Deleted' : 'Deleted (Local Only)',
    detail: `Venue "${name}" removed`,
    life: 3000,
  })
}

const VENUE_SEVERITY_MAP: Readonly<
  Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'>
> = {
  Hall: 'info',
  Room: 'success',
  Restaurant: 'warn',
  Outdoor: 'secondary',
  Other: 'secondary',
}

function getVenueTypeSeverity(
  type: string,
): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
  return VENUE_SEVERITY_MAP[type] ?? 'secondary'
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */

onMounted(() => {
  initConventionForm()
})
</script>
