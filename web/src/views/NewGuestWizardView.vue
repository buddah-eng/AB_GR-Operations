<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">New Guest Wizard</h1>
      <Button
        label="Cancel"
        icon="pi pi-times"
        severity="secondary"
        size="small"
        @click="router.push({ name: 'guests' })"
      />
    </div>

    <!-- Step indicator -->
    <div class="flex items-center overflow-x-auto gap-1 mb-4">
      <template v-for="(s, i) in stepLabels" :key="i">
        <div
          class="flex items-center cursor-pointer"
          @click="goToStep(i)"
        >
          <div
            :class="[
              'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
              i < step ? 'bg-emerald-500 text-white' : '',
              i === step ? 'bg-accent-500 text-white' : '',
              i > step ? 'bg-surface-200 text-surface-500' : '',
            ]"
          >
            <i v-if="i < step" class="pi pi-check text-xs" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span class="ml-2 text-sm font-medium mr-2 whitespace-nowrap">{{ s }}</span>
        </div>
        <div v-if="i < stepLabels.length - 1" class="h-0.5 w-8 bg-surface-300 mx-1" />
      </template>
    </div>

    <!-- Step 0: Guest Info -->
    <Card v-if="step === 0">
      <template #title>Guest Information</template>
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Guest Name *</label>
            <InputText v-model="guest['Guest Name']" :invalid="!!errors['Guest Name']" />
            <small v-if="errors['Guest Name']" class="text-red-500">{{ errors['Guest Name'] }}</small>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Guest Type *</label>
            <Select v-model="guest['Guest Type']" :options="guestTypeOptions" placeholder="Select type" :invalid="!!errors['Guest Type']" />
            <small v-if="errors['Guest Type']" class="text-red-500">{{ errors['Guest Type'] }}</small>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Department *</label>
            <Select v-model="guest.Department" :options="deptOptions" placeholder="Select department" :invalid="!!errors.Department" />
            <small v-if="errors.Department" class="text-red-500">{{ errors.Department }}</small>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Status *</label>
            <Select v-model="guest.Status" :options="['Invited', 'Confirmed']" placeholder="Select status" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Company/Affiliation</label>
            <InputText v-model="guest['Company/Affiliation']" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Interpreter Required</label>
            <Select v-model="guest['Interpreter Required']" :options="['No', 'Yes']" />
          </div>
          <div class="flex flex-col gap-2 md:col-span-2">
            <label class="text-sm font-medium">Research Links</label>
            <Textarea v-model="guest['Research Links']" rows="2" />
          </div>
          <div class="flex flex-col gap-2 md:col-span-2">
            <label class="text-sm font-medium">Special Handling Notes</label>
            <Textarea v-model="guest['Special Handling Notes']" rows="2" />
          </div>
        </div>
      </template>
    </Card>

    <!-- Step 1: Staff Assignment -->
    <Card v-if="step === 1">
      <template #title>Staff Assignment</template>
      <template #content>
        <p class="text-sm text-surface-500 mb-4">
          Assign staff to this guest. At least a Main Liaison is recommended.
        </p>
        <div
          v-for="(p, idx) in pairings"
          :key="idx"
          class="bg-surface-50 rounded-lg p-4 mb-3"
        >
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Role *</label>
              <Select v-model="p.Role" :options="roleOptions" placeholder="Select role" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Staff Member *</label>
              <Select v-model="p['Staff ID']" :options="staffSelectOptions" optionLabel="label" optionValue="value" placeholder="Select staff" />
            </div>
            <div class="flex items-end">
              <Button
                v-if="pairings.length > 1"
                label="Remove"
                icon="pi pi-trash"
                severity="danger"
                text
                size="small"
                @click="removePairingEntry(idx)"
              />
            </div>
          </div>
        </div>
        <Button label="Add Staff Assignment" icon="pi pi-plus" severity="secondary" size="small" class="mt-2" @click="addPairingEntry" />
      </template>
    </Card>

    <!-- Step 2: Schedule -->
    <Card v-if="step === 2">
      <template #title>Schedule Events</template>
      <template #content>
        <p class="text-sm text-surface-500 mb-4">
          Add events for this guest. You can add more later from the Guest Hub.
        </p>
        <div
          v-for="(evt, idx) in scheduleEvents"
          :key="idx"
          class="bg-surface-50 rounded-lg p-4 mb-3"
        >
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium text-surface-700">Event {{ idx + 1 }}</span>
            <Button
              v-if="scheduleEvents.length > 1"
              icon="pi pi-trash"
              severity="danger"
              text
              size="small"
              @click="removeEventEntry(idx)"
            />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Activity *</label>
              <InputText v-model="evt.Activity" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Event Type *</label>
              <Select v-model="evt['Event Type']" :options="eventTypeOptions" placeholder="Select" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Date *</label>
              <InputText v-model="evt.Date" type="date" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Start Time *</label>
              <InputText v-model="evt['Start Time']" type="time" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">End Time *</label>
              <InputText v-model="evt['End Time']" type="time" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">Venue</label>
              <Select v-model="evt.Venue" :options="venueOptions" placeholder="Select" showClear />
            </div>
            <div class="flex flex-col gap-1 md:col-span-3">
              <label class="text-sm font-medium">Description</label>
              <Textarea v-model="evt.Description" rows="2" />
            </div>
          </div>
        </div>
        <Button label="Add Event" icon="pi pi-plus" severity="secondary" size="small" class="mt-2" @click="addEventEntry" />
      </template>
    </Card>

    <!-- Step 3: Travel -->
    <Card v-if="step === 3">
      <template #title>Travel Details</template>
      <template #content>
        <p class="text-sm text-surface-500 mb-4">Optional. Add arrival/departure info.</p>
        <div class="flex items-center mb-4">
          <Checkbox v-model="hasTravel" :binary="true" inputId="hasTravel" />
          <label for="hasTravel" class="ml-2 text-sm text-surface-700">Guest has travel info</label>
        </div>
        <div v-if="hasTravel" class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Travel Type</label>
            <Select v-model="travel['Travel Type']" :options="['Flight', 'Train', 'Car', 'Bus']" placeholder="Select" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Carrier</label>
            <InputText v-model="travel.Carrier" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Flight/Route</label>
            <InputText v-model="travel['Flight/Route']" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Departure Date</label>
            <InputText v-model="travel['Departure Date']" type="date" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Departure Time</label>
            <InputText v-model="travel['Departure Time']" type="time" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Arrival Date</label>
            <InputText v-model="travel['Arrival Date']" type="date" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Arrival Time</label>
            <InputText v-model="travel['Arrival Time']" type="time" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Confirmation #</label>
            <InputText v-model="travel['Confirmation Number']" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Status</label>
            <Select v-model="travel.Status" :options="['Pending', 'Confirmed']" />
          </div>
        </div>
      </template>
    </Card>

    <!-- Step 4: Dietary -->
    <Card v-if="step === 4">
      <template #title>Dietary Requirements</template>
      <template #content>
        <p class="text-sm text-surface-500 mb-4">Optional. Add any dietary restrictions or preferences.</p>
        <div class="flex items-center mb-4">
          <Checkbox v-model="hasDietary" :binary="true" inputId="hasDietary" />
          <label for="hasDietary" class="ml-2 text-sm text-surface-700">Guest has dietary requirements</label>
        </div>
        <div v-if="hasDietary" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Dietary Type</label>
            <Select v-model="dietary['Dietary Type']" :options="['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-Free', 'Other']" placeholder="Select" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Restrictions</label>
            <InputText v-model="dietary.Restrictions" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Allergies</label>
            <InputText v-model="dietary.Allergies" placeholder="Separate multiple with commas" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Preferences</label>
            <InputText v-model="dietary.Preferences" />
          </div>
        </div>
      </template>
    </Card>

    <!-- Step 5: Review & Submit -->
    <Card v-if="step === 5">
      <template #title>Review &amp; Create Guest</template>
      <template #content>
        <div class="space-y-6">
          <!-- Guest info summary -->
          <div>
            <h3 class="font-medium text-surface-800 mb-2">Guest Info</h3>
            <div class="bg-surface-50 rounded-lg p-4">
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div><span class="text-surface-500">Name:</span> {{ guest['Guest Name'] }}</div>
                <div><span class="text-surface-500">Type:</span> {{ guest['Guest Type'] }}</div>
                <div><span class="text-surface-500">Department:</span> {{ guest.Department }}</div>
                <div><span class="text-surface-500">Status:</span> {{ guest.Status }}</div>
                <div v-if="guest['Company/Affiliation']">
                  <span class="text-surface-500">Company:</span> {{ guest['Company/Affiliation'] }}
                </div>
                <div><span class="text-surface-500">Interpreter:</span> {{ guest['Interpreter Required'] || 'No' }}</div>
              </div>
            </div>
          </div>

          <!-- Staff summary -->
          <div v-if="validPairings.length > 0">
            <h3 class="font-medium text-surface-800 mb-2">Staff ({{ validPairings.length }})</h3>
            <div class="bg-surface-50 rounded-lg p-4">
              <div v-for="p in validPairings" :key="p.Role + p['Staff ID']" class="text-sm py-1">
                <span class="font-medium">{{ p.Role }}</span>:
                {{ getStaffName(p['Staff ID']) }}
              </div>
            </div>
          </div>

          <!-- Events summary -->
          <div v-if="validEvents.length > 0">
            <h3 class="font-medium text-surface-800 mb-2">Events ({{ validEvents.length }})</h3>
            <div class="bg-surface-50 rounded-lg p-4">
              <div v-for="(evt, i) in validEvents" :key="i" class="text-sm py-1">
                <span class="font-medium">{{ evt.Activity }}</span> --
                {{ evt.Date }} {{ evt['Start Time'] }}-{{ evt['End Time'] }}
                <span v-if="evt.Venue" class="text-surface-500">@ {{ evt.Venue }}</span>
              </div>
            </div>
          </div>

          <!-- Travel summary -->
          <div v-if="hasTravel && travel['Travel Type']">
            <h3 class="font-medium text-surface-800 mb-2">Travel</h3>
            <div class="bg-surface-50 rounded-lg p-4 text-sm">
              {{ travel['Travel Type'] }}
              <span v-if="travel.Carrier"> -- {{ travel.Carrier }}</span>
              <span v-if="travel['Flight/Route']"> ({{ travel['Flight/Route'] }})</span>
              <div v-if="travel['Departure Date']" class="mt-1">
                Departs: {{ travel['Departure Date'] }} {{ travel['Departure Time'] }}
              </div>
              <div v-if="travel['Arrival Date']" class="mt-1">
                Arrives: {{ travel['Arrival Date'] }} {{ travel['Arrival Time'] }}
              </div>
            </div>
          </div>

          <!-- Dietary summary -->
          <div v-if="hasDietary && dietary['Dietary Type']">
            <h3 class="font-medium text-surface-800 mb-2">Dietary</h3>
            <div class="bg-surface-50 rounded-lg p-4 text-sm">
              <div>Type: {{ dietary['Dietary Type'] }}</div>
              <div v-if="dietary.Restrictions">Restrictions: {{ dietary.Restrictions }}</div>
              <div v-if="dietary.Allergies">Allergies: {{ dietary.Allergies }}</div>
              <div v-if="dietary.Preferences">Preferences: {{ dietary.Preferences }}</div>
            </div>
          </div>

          <Message severity="info" :closable="false">
            Prep checklist items will be auto-generated from templates after guest creation.
          </Message>
        </div>
      </template>
    </Card>

    <!-- Navigation buttons -->
    <div class="flex justify-between">
      <Button
        v-if="step > 0"
        label="Back"
        icon="pi pi-arrow-left"
        severity="secondary"
        @click="prevStep"
      />
      <div v-else />
      <div class="flex gap-3">
        <Button
          v-if="step < 5"
          label="Continue"
          icon="pi pi-arrow-right"
          iconPos="right"
          @click="nextStep"
        />
        <Button
          v-if="step === 5"
          :label="submitting ? 'Creating Guest...' : 'Create Guest'"
          icon="pi pi-check"
          :loading="submitting"
          @click="submitWizard"
        />
      </div>
    </div>

    <!-- Submission result -->
    <Card v-if="submitResult">
      <template #content>
        <div
          v-if="submitResult.guestResult && submitResult.guestResult.status === 'APPLIED'"
          class="text-green-700"
        >
          <h3 class="font-bold mb-2">Guest Created Successfully</h3>
          <p class="text-sm mb-1">Guest ID: {{ submitResult.guestResult.pk }}</p>
          <p class="text-sm mb-1">Pairings: {{ (submitResult.pairingResults || []).length }} created</p>
          <p class="text-sm mb-1">Events: {{ (submitResult.scheduleResults || []).length }} created</p>
          <p class="text-sm mb-1">Prep items: {{ (submitResult.prepResults || []).length }} generated</p>
          <Button
            label="View Guest Hub"
            icon="pi pi-eye"
            size="small"
            class="mt-3"
            @click="router.push({ name: 'guest-hub', params: { id: submitResult.guestResult.pk } })"
          />
        </div>
        <div v-else class="text-red-700">
          <h3 class="font-bold mb-2">Creation Failed</h3>
          <p class="text-sm">{{ submitResult.error || 'Unknown error' }}</p>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from 'primevue/usetoast'
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Checkbox from 'primevue/checkbox'
import Message from 'primevue/message'
import { useAppStore } from '@/stores/app'
import { api } from '@/api/client'

/* ---- Types ---- */

interface StaffMember {
  staffId: string
  name: string
  role?: string
}

interface Pairing {
  Role: string
  'Staff ID': string
  Notes: string
}

interface ScheduleEventEntry {
  Activity: string
  'Event Type': string
  Date: string
  'Start Time': string
  'End Time': string
  Venue: string
  Description: string
  Status: string
}

interface GuestData {
  'Guest Name': string
  'Guest Type': string
  Department: string
  Status: string
  'Company/Affiliation': string
  'Interpreter Required': string
  'Research Links': string
  'Special Handling Notes': string
}

interface TravelData {
  'Travel Type': string
  Carrier: string
  'Flight/Route': string
  'Departure Date': string
  'Departure Time': string
  'Arrival Date': string
  'Arrival Time': string
  'Confirmation Number': string
  Notes: string
  Status: string
}

interface DietaryData {
  'Dietary Type': string
  Restrictions: string
  Allergies: string
  Preferences: string
}

interface WizardResult {
  guestResult?: { status: string; pk: string }
  pairingResults?: Record<string, unknown>[]
  scheduleResults?: Record<string, unknown>[]
  prepResults?: Record<string, unknown>[]
  error?: string
}

/* ---- Composables ---- */

const router = useRouter()
const toast = useToast()
const appStore = useAppStore()

/* ---- State ---- */

const step = ref(0)
const submitting = ref(false)
const submitResult = ref<WizardResult | null>(null)
const errors = reactive<Record<string, string>>({})
const staffList = ref<StaffMember[]>([])

const stepLabels = ['Guest Info', 'Staff', 'Schedule', 'Travel', 'Dietary', 'Review']

const guest = reactive<GuestData>({
  'Guest Name': '', 'Guest Type': '', Department: '', Status: 'Invited',
  'Company/Affiliation': '', 'Interpreter Required': 'No',
  'Research Links': '', 'Special Handling Notes': '',
})

const pairings = reactive<Pairing[]>([{ Role: '', 'Staff ID': '', Notes: '' }])

const scheduleEvents = reactive<ScheduleEventEntry[]>([{
  Activity: '', 'Event Type': '', Date: '', 'Start Time': '', 'End Time': '',
  Venue: '', Description: '', Status: 'Scheduled',
}])

const hasTravel = ref(false)
const travel = reactive<TravelData>({
  'Travel Type': '', Carrier: '', 'Flight/Route': '', 'Departure Date': '',
  'Departure Time': '', 'Arrival Date': '', 'Arrival Time': '',
  'Confirmation Number': '', Notes: '', Status: 'Pending',
})

const hasDietary = ref(false)
const dietary = reactive<DietaryData>({
  'Dietary Type': '', Restrictions: '', Allergies: '', Preferences: '',
})

/* ---- Options ---- */

const guestTypeOptions = ['Industry Guest', 'Musical Guest', 'Voice Actor', 'Artist', 'Creator']

const deptOptions = computed<string[]>(() =>
  (appStore.config?.departments ?? [])
    .map((d) => (d['Department Name'] as string) || (d['department_name'] as string) || '')
    .filter(Boolean),
)
const roleOptions = computed<string[]>(() =>
  (appStore.config?.roles ?? [])
    .map((r) => (r['Role Name'] as string) || (r['role_name'] as string) || '')
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

const staffSelectOptions = computed(() =>
  staffList.value.map((s) => ({
    value: s.staffId,
    label: s.name + (s.role ? ' (' + s.role + ')' : ''),
  })),
)

const validPairings = computed(() => pairings.filter((p) => p.Role && p['Staff ID']))
const validEvents = computed(() => scheduleEvents.filter((e) => e.Activity && e.Date))

/* ---- Staff helpers ---- */

function loadStaffList(): void {
  api.call<StaffMember[]>('getStaffList', { filters: {} })
    .then((data) => {
      staffList.value = data
    })
    .catch(() => {
      // Silently handle - staff list is non-critical here
    })
}

function getStaffName(staffId: string): string {
  const found = staffList.value.find((s) => s.staffId === staffId)
  return found ? found.name : staffId
}

/* ---- Navigation ---- */

function goToStep(target: number): void {
  if (target < step.value) {
    step.value = target
  }
}

function nextStep(): void {
  if (step.value === 0) {
    for (const k of Object.keys(errors)) {
      delete errors[k]
    }
    if (!guest['Guest Name']) errors['Guest Name'] = 'Required'
    if (!guest['Guest Type']) errors['Guest Type'] = 'Required'
    if (!guest.Department) errors.Department = 'Required'
    if (Object.keys(errors).length > 0) {
      toast.add({ severity: 'warn', summary: 'Validation', detail: 'Please fill required fields', life: 3000 })
      return
    }
  }
  step.value = Math.min(step.value + 1, 5)
}

function prevStep(): void {
  step.value = Math.max(step.value - 1, 0)
}

/* ---- List management ---- */

function addPairingEntry(): void {
  pairings.push({ Role: '', 'Staff ID': '', Notes: '' })
}

function removePairingEntry(idx: number): void {
  pairings.splice(idx, 1)
}

function addEventEntry(): void {
  scheduleEvents.push({
    Activity: '', 'Event Type': '', Date: '', 'Start Time': '', 'End Time': '',
    Venue: '', Description: '', Status: 'Scheduled',
  })
}

function removeEventEntry(idx: number): void {
  scheduleEvents.splice(idx, 1)
}

/* ---- Submission ---- */

function submitWizard(): void {
  submitting.value = true
  submitResult.value = null

  const params: Record<string, unknown> = {
    guest: { ...guest },
    pairings: validPairings.value.map((p) => ({ ...p })),
    schedule: validEvents.value.map((e) => ({ ...e })),
  }

  if (hasTravel.value && travel['Travel Type']) {
    params.travel = { ...travel }
  }
  if (hasDietary.value && dietary['Dietary Type']) {
    params.dietary = { ...dietary }
  }

  api.call<WizardResult>('wizardCreateGuest', params)
    .then((result) => {
      submitResult.value = result
      if (result.guestResult && result.guestResult.status === 'APPLIED') {
        toast.add({ severity: 'success', summary: 'Success', detail: 'Guest created successfully!', life: 4000 })
      } else {
        toast.add({ severity: 'error', summary: 'Failed', detail: 'Guest creation failed', life: 4000 })
      }
    })
    .catch((err: Error) => {
      submitResult.value = { error: err.message }
      toast.add({ severity: 'error', summary: 'Error', detail: err.message, life: 4000 })
    })
    .finally(() => {
      submitting.value = false
    })
}

/* ---- Lifecycle ---- */

onMounted(loadStaffList)
</script>
