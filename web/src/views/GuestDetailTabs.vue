<template>
  <!-- SCHEDULE TAB -->
  <TabPanel :header="'Schedule (' + schedule.length + ')'" value="1">
    <div class="flex justify-end mb-4">
      <Button
        :label="showAddSchedule ? 'Cancel' : 'Add Event'"
        :icon="showAddSchedule ? 'pi pi-times' : 'pi pi-plus'"
        size="small"
        @click="showAddSchedule = !showAddSchedule"
      />
    </div>
    <Card v-if="showAddSchedule" class="mb-4">
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Activity *</label>
            <InputText v-model="newEvent.Activity" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Event Type *</label>
            <Select v-model="newEvent['Event Type']" :options="eventTypeOptions" placeholder="Select" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Date *</label>
            <InputText v-model="newEvent.Date" type="date" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Start Time *</label>
            <InputText v-model="newEvent['Start Time']" type="time" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">End Time *</label>
            <InputText v-model="newEvent['End Time']" type="time" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Venue</label>
            <Select v-model="newEvent.Venue" :options="venueOptions" placeholder="Select" showClear />
          </div>
          <div class="flex flex-col gap-1 md:col-span-3">
            <label class="text-sm font-medium">Description</label>
            <Textarea v-model="newEvent.Description" rows="2" />
          </div>
        </div>
        <Button label="Create Event" icon="pi pi-check" size="small" class="mt-3" :loading="saving" @click="handleAddEvent" />
      </template>
    </Card>
    <DataTable :value="schedule" stripedRows>
      <template #empty><div class="text-center py-6 text-surface-400">No events scheduled</div></template>
      <Column field="Date" header="Date" sortable />
      <Column field="Start Time" header="Start" />
      <Column field="End Time" header="End" />
      <Column field="Activity" header="Activity" />
      <Column field="Event Type" header="Type" />
      <Column field="Venue" header="Venue" />
      <Column field="Status" header="Status">
        <template #body="{ data: row }">
          <Tag :value="String(row.Status ?? '')" rounded />
        </template>
      </Column>
    </DataTable>
  </TabPanel>

  <!-- TRAVEL TAB -->
  <TabPanel :header="'Travel (' + travel.length + ')'" value="2">
    <div class="flex justify-end mb-4">
      <Button
        :label="showAddTravel ? 'Cancel' : 'Add Travel'"
        :icon="showAddTravel ? 'pi pi-times' : 'pi pi-plus'"
        size="small"
        @click="showAddTravel = !showAddTravel"
      />
    </div>
    <Card v-if="showAddTravel" class="mb-4">
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Travel Type *</label>
            <Select v-model="newTravel['Travel Type']" :options="['Flight', 'Train', 'Car', 'Bus']" placeholder="Select" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Carrier</label>
            <InputText v-model="newTravel.Carrier" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Flight/Route</label>
            <InputText v-model="newTravel['Flight/Route']" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Departure Date</label>
            <InputText v-model="newTravel['Departure Date']" type="date" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Departure Time</label>
            <InputText v-model="newTravel['Departure Time']" type="time" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Arrival Date</label>
            <InputText v-model="newTravel['Arrival Date']" type="date" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Arrival Time</label>
            <InputText v-model="newTravel['Arrival Time']" type="time" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Confirmation #</label>
            <InputText v-model="newTravel['Confirmation Number']" />
          </div>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Status</label>
            <Select v-model="newTravel.Status" :options="['Pending', 'Confirmed', 'Cancelled']" placeholder="Select" />
          </div>
        </div>
        <Button label="Add Travel" icon="pi pi-check" size="small" class="mt-3" :loading="saving" @click="handleAddTravel" />
      </template>
    </Card>
    <DataTable :value="travel" stripedRows>
      <template #empty><div class="text-center py-6 text-surface-400">No travel records</div></template>
      <Column field="Travel Type" header="Type" />
      <Column field="Carrier" header="Carrier" />
      <Column field="Flight/Route" header="Flight" />
      <Column field="Departure Date" header="Depart" />
      <Column field="Arrival Date" header="Arrive" />
      <Column field="Status" header="Status">
        <template #body="{ data: row }">
          <Tag :value="String(row.Status ?? '')" rounded />
        </template>
      </Column>
    </DataTable>
  </TabPanel>

  <!-- ACCOMMODATIONS TAB -->
  <TabPanel :header="'Accom (' + accommodations.length + ')'" value="3">
    <DataTable :value="accommodations" stripedRows>
      <template #empty><div class="text-center py-6 text-surface-400">No accommodation records</div></template>
      <Column field="Hotel" header="Hotel" />
      <Column field="Room Type" header="Room" />
      <Column field="Check In" header="Check In" />
      <Column field="Check Out" header="Check Out" />
      <Column field="Status" header="Status">
        <template #body="{ data: row }">
          <Tag :value="String(row.Status ?? '')" rounded />
        </template>
      </Column>
    </DataTable>
  </TabPanel>

  <!-- DIETARY TAB -->
  <TabPanel :header="'Dietary (' + dietary.length + ')'" value="4">
    <DataTable :value="dietary" stripedRows>
      <template #empty><div class="text-center py-6 text-surface-400">No dietary info</div></template>
      <Column field="Dietary Type" header="Type" />
      <Column field="Restrictions" header="Restrictions" />
      <Column field="Allergies" header="Allergies" />
      <Column field="Preferences" header="Preferences" />
    </DataTable>
  </TabPanel>

  <!-- AUTOGRAPHS TAB -->
  <TabPanel :header="'Autographs (' + autographs.length + ')'" value="5">
    <DataTable :value="autographs" stripedRows>
      <template #empty><div class="text-center py-6 text-surface-400">No autograph sessions</div></template>
      <Column field="Pricing" header="Pricing" />
      <Column field="Table Location" header="Location" />
      <Column field="Session Count" header="Sessions" />
    </DataTable>
  </TabPanel>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import TabPanel from 'primevue/tabpanel'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import Tag from 'primevue/tag'

defineProps<{
  schedule: Record<string, unknown>[]
  travel: Record<string, unknown>[]
  accommodations: Record<string, unknown>[]
  dietary: Record<string, unknown>[]
  autographs: Record<string, unknown>[]
  eventTypeOptions: string[]
  venueOptions: string[]
  saving: boolean
}>()

const emit = defineEmits<{
  addEvent: [data: Record<string, string>]
  addTravel: [data: Record<string, string>]
}>()

const showAddSchedule = ref(false)
const showAddTravel = ref(false)

const newEvent = reactive<Record<string, string>>({
  Activity: '', 'Event Type': '', Date: '', 'Start Time': '', 'End Time': '',
  Venue: '', Description: '', Status: 'Scheduled',
})

const newTravel = reactive<Record<string, string>>({
  'Travel Type': '', Carrier: '', 'Flight/Route': '', 'Departure Date': '',
  'Departure Time': '', 'Arrival Date': '', 'Arrival Time': '',
  'Confirmation Number': '', Notes: '', Status: 'Pending',
})

function handleAddEvent(): void {
  emit('addEvent', { ...newEvent })
  showAddSchedule.value = false
  for (const k of Object.keys(newEvent)) {
    if (k !== 'Status') newEvent[k] = ''
  }
}

function handleAddTravel(): void {
  emit('addTravel', { ...newTravel })
  showAddTravel.value = false
  for (const k of Object.keys(newTravel)) {
    if (k !== 'Status') newTravel[k] = ''
  }
}
</script>
