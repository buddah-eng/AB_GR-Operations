<template>
  <div class="space-y-6">
    <!-- Back button + title + actions -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <Button
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          rounded
          @click="router.back()"
          aria-label="Go back"
        />
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          {{ recordTitle }}
        </h1>
        <!-- Status badge + change dropdown (RBAC: director/coordinator only) -->
        <Select
          v-if="currentStatus && canEdit"
          v-model="currentStatus"
          :options="statusOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Status"
          class="w-40"
          @change="handleStatusChange"
        />
        <span
          v-else-if="currentStatus"
          class="inline-flex items-center rounded-full bg-surface-100 px-3 py-1 text-sm font-medium text-surface-700"
        >
          {{ titleCase(currentStatus) }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="canEdit"
          label="Edit"
          icon="pi pi-pencil"
          severity="secondary"
          @click="navigateToEdit"
        />
        <Button
          v-if="isDirectorOrAbove"
          icon="pi pi-cog"
          severity="secondary"
          text
          rounded
          aria-label="Customize view"
          @click="router.push({ name: 'view-builder', params: { conceptKey: conceptKey } })"
        />
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="animate-pulse space-y-4">
      <div class="h-8 bg-surface-200 rounded w-1/3" />
      <div class="grid grid-cols-2 gap-4">
        <div class="h-6 bg-surface-200 rounded" v-for="n in 6" :key="n" />
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
      <p class="text-red-700">{{ error }}</p>
    </div>

    <!-- Detail content -->
    <template v-else-if="record">
      <!-- Header fields -->
      <DynamicView
        v-if="viewConfig"
        :config="viewConfig"
        :data="[record]"
        :loading="false"
      />

      <!-- Tabs for related concepts -->
      <TabView v-if="tabs.length > 0" class="mt-6">
        <TabPanel
          v-for="(tab, index) in tabs"
          :key="tab.label"
          :value="String(index)"
          :header="tab.label"
        >
          <ConfigListEmbed
            :concept-key="tab.conceptKey"
            :view-name="tab.viewName"
            :filter="resolveTabFilter(tab.filter)"
          />
        </TabPanel>
      </TabView>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import Select from 'primevue/select'
import TabView from 'primevue/tabview'
import TabPanel from 'primevue/tabpanel'
import { useToast } from 'primevue/usetoast'
import DynamicView from '@/components/views/DynamicView.vue'
import ConfigListEmbed from './ConfigListEmbed.vue'
import { useViewConfig } from '@/composables/useViewConfig'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/api/client'
import type { ViewTab } from '@/types/views'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const authStore = useAuthStore()

const conceptKey = computed(() => (route.meta.conceptKey as string) ?? '')
const viewName = computed(() => (route.meta.viewName as string) ?? 'detail-view')
const recordId = computed(() => route.params.id as string)

const { config: viewConfig, error: _configError } = useViewConfig(conceptKey, viewName)

const record = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const currentStatus = ref<string | null>(null)

const canEdit = computed(() =>
  ['director', 'coordinator', 'department_head'].includes(authStore.role as string ?? '')
)

const isDirectorOrAbove = computed(() =>
  ['director', 'admin'].includes(authStore.role ?? '')
)

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['invited', 'canceled'],
  invited: ['confirmed', 'declined', 'canceled'],
  confirmed: ['travel_arranged', 'canceled'],
  travel_arranged: ['arrived', 'canceled'],
  arrived: ['attending', 'canceled'],
  attending: ['departed'],
  departed: [],
  canceled: ['draft'],
  declined: ['draft'],
}
const statusOptions = computed(() => {
  const raw = STATUS_TRANSITIONS[currentStatus.value ?? ''] ?? []
  return raw.map(s => ({ label: titleCase(s), value: s }))
})

const recordTitle = computed(() => {
  if (!record.value) return 'Loading...'
  const props = (record.value.properties ?? {}) as Record<string, unknown>
  return (props.name ?? record.value.name ?? record.value.title ?? recordId.value) as string
})

const tabs = computed<ViewTab[]>(() => viewConfig.value?.tabs ?? [])

function resolveTabFilter(filter: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(filter)) {
    resolved[key] = value === '{{record.id}}' ? recordId.value : value
  }
  return resolved
}

function navigateToEdit(): void {
  // Derive edit path from current detail route: /guests/123 -> /guests/123/edit
  const currentPath = route.path.replace(/\/$/, '')
  router.push(`${currentPath}/edit`)
}

async function handleStatusChange(): Promise<void> {
  if (!currentStatus.value || !recordId.value) return
  try {
    await api.put(`/api/domains/${conceptKey.value}/${recordId.value}`, {
      status: currentStatus.value,
    })
    toast.add({ severity: 'success', summary: 'Status Updated', detail: `Status changed to "${currentStatus.value}"`, life: 3000 })
    // Reload record to get fresh data + trigger any workflow side effects
    await loadRecord()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Status change failed'
    toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
    // Reload to revert to actual status
    await loadRecord()
  }
}

async function loadRecord(): Promise<void> {
  try {
    const data = await api.get<Record<string, unknown>>(
      `/api/domains/${conceptKey.value}/${recordId.value}`
    )
    record.value = data
    const props = (data.properties ?? {}) as Record<string, unknown>
    currentStatus.value = (props.status ?? data.status ?? null) as string | null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load record'
    error.value = message
    toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
  } finally {
    loading.value = false
  }
}

onMounted(loadRecord)
</script>
