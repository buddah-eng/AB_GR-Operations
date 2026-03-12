<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">Staff</h1>
      <Button
        :label="showAddForm ? 'Cancel' : 'Add Staff'"
        :icon="showAddForm ? 'pi pi-times' : 'pi pi-plus'"
        @click="showAddForm = !showAddForm"
      />
    </div>

    <!-- Add Staff Form -->
    <Card v-if="showAddForm">
      <template #title>New Staff Member</template>
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-surface-700">Name *</label>
            <InputText v-model="newStaff.Name" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-surface-700">Email *</label>
            <InputText v-model="newStaff.Email" type="email" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-surface-700">Role *</label>
            <Select v-model="newStaff.Role" :options="roleOptions" placeholder="Select role" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-surface-700">Department *</label>
            <Select v-model="newStaff.Department" :options="deptOptions" placeholder="Select department" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-surface-700">Phone</label>
            <InputText v-model="newStaff.Phone" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium text-surface-700">LINE ID</label>
            <InputText v-model="newStaff['LINE ID']" />
          </div>
        </div>
        <div class="mt-4">
          <Button
            label="Add Staff"
            icon="pi pi-check"
            :loading="saving"
            @click="addStaff"
          />
        </div>
      </template>
    </Card>

    <!-- Toolbar with search and filters -->
    <Toolbar>
      <template #start>
        <IconField class="mr-2">
          <InputIcon class="pi pi-search" />
          <InputText
            v-model="searchQuery"
            placeholder="Search staff..."
            class="w-56"
          />
        </IconField>
        <Select
          v-model="filterDepartment"
          :options="deptOptions"
          placeholder="All Departments"
          showClear
          class="w-48 mr-2"
          @change="loadData"
        />
        <Select
          v-model="filterRole"
          :options="roleOptions"
          placeholder="All Roles"
          showClear
          class="w-48"
          @change="loadData"
        />
      </template>
      <template #end>
        <span class="text-sm text-surface-500">
          {{ filteredStaff.length }} staff member{{ filteredStaff.length !== 1 ? 's' : '' }}
        </span>
      </template>
    </Toolbar>

    <!-- Staff data table -->
    <DataTable
      :value="filteredStaff"
      :loading="loading"
      :paginator="filteredStaff.length > 25"
      :rows="25"
      :rowsPerPageOptions="[10, 25, 50]"
      sortMode="single"
      removableSort
      stripedRows
      tableStyle="min-width: 50rem"
    >
      <template #empty>
        <div class="text-center py-8 text-surface-400">No staff found</div>
      </template>

      <Column field="name" header="Name" sortable style="min-width: 10rem" />
      <Column field="email" header="Email" sortable style="min-width: 12rem" />
      <Column field="role" header="Role" sortable style="min-width: 8rem">
        <template #body="{ data: row }">
          <Tag :value="row.role" severity="info" rounded />
        </template>
      </Column>
      <Column field="department" header="Department" sortable style="min-width: 8rem" />
      <Column field="phone" header="Phone" style="min-width: 8rem" />
      <Column field="availability" header="Availability" style="min-width: 8rem">
        <template #body="{ data: row }">
          <Tag
            v-if="row.availability"
            :value="row.availability"
            :severity="getAvailabilitySeverity(row.availability)"
            rounded
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Toolbar from 'primevue/toolbar'
import Card from 'primevue/card'
import Select from 'primevue/select'
import InputText from 'primevue/inputtext'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import Tag from 'primevue/tag'
import { useAppStore } from '@/stores/app'
import { api } from '@/api/client'
import type { StaffSummary, WriteResult } from '@/types'

interface NewStaffForm {
  Name: string
  Email: string
  Role: string
  Department: string
  Phone: string
  'LINE ID': string
  Availability: string
  [key: string]: string
}

const toast = useToast()
const appStore = useAppStore()

const staff = ref<StaffSummary[]>([])
const loading = ref(false)
const saving = ref(false)
const showAddForm = ref(false)
const searchQuery = ref('')
const filterDepartment = ref<string | null>(null)
const filterRole = ref<string | null>(null)

const newStaff = ref<NewStaffForm>({
  Name: '',
  Email: '',
  Role: '',
  Department: '',
  Phone: '',
  'LINE ID': '',
  Availability: '',
})

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

const filteredStaff = computed<StaffSummary[]>(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return staff.value
  return staff.value.filter((s) => {
    const name = String(s.name ?? '').toLowerCase()
    const email = String(s.email ?? '').toLowerCase()
    const role = String(s.role ?? '').toLowerCase()
    const department = String(s.department ?? '').toLowerCase()
    return (
      name.includes(query) ||
      email.includes(query) ||
      role.includes(query) ||
      department.includes(query)
    )
  })
})

function getAvailabilitySeverity(availability: string): 'success' | 'warn' | 'danger' | 'secondary' {
  const lower = String(availability).toLowerCase()
  const map: Record<string, 'success' | 'warn' | 'danger' | 'secondary'> = {
    available: 'success',
    limited: 'warn',
    unavailable: 'danger',
  }
  return map[lower] ?? 'secondary'
}

function loadData(): void {
  loading.value = true
  const filters: Record<string, string> = {}
  if (filterDepartment.value) filters.department = filterDepartment.value
  if (filterRole.value) filters.role = filterRole.value

  api.call<StaffSummary[]>('getStaffList', { filters })
    .then((data) => {
      staff.value = data
    })
    .catch((err: Error) => {
      toast.add({
        severity: 'error',
        summary: 'Load Failed',
        detail: 'Failed to load staff: ' + err.message,
        life: 4000,
      })
    })
    .finally(() => {
      loading.value = false
    })
}

function addStaff(): void {
  const s = newStaff.value
  if (!s.Name || !s.Email || !s.Role || !s.Department) {
    toast.add({
      severity: 'warn',
      summary: 'Validation',
      detail: 'Name, Email, Role, and Department are required',
      life: 3000,
    })
    return
  }
  saving.value = true
  api.call<WriteResult>('createStaff', { data: { ...s } })
    .then((result) => {
      if (result.status === 'APPLIED') {
        toast.add({ severity: 'success', summary: 'Added', detail: 'Staff member added', life: 3000 })
        showAddForm.value = false
        newStaff.value = {
          Name: '', Email: '', Role: '', Department: '',
          Phone: '', 'LINE ID': '', Availability: '',
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
      saving.value = false
    })
}

onMounted(loadData)
</script>
