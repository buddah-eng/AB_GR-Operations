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
        <!-- Status badge + change dropdown -->
        <Select
          v-if="currentStatus"
          v-model="currentStatus"
          :options="statusOptions"
          placeholder="Status"
          class="w-40"
          @change="handleStatusChange"
        />
      </div>
      <div class="flex items-center gap-2">
        <Button
          label="Edit"
          icon="pi pi-pencil"
          severity="secondary"
          @click="navigateToEdit"
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
import DynamicView from '@/components/views/DynamicView.vue'
import ConfigListEmbed from './ConfigListEmbed.vue'
import { useViewConfig } from '@/composables/useViewConfig'
import { api } from '@/api/client'
import type { ViewTab } from '@/types/views'

const route = useRoute()
const router = useRouter()

const conceptKey = computed(() => (route.meta.conceptKey as string) ?? '')
const viewName = computed(() => (route.meta.viewName as string) ?? 'detail-view')
const recordId = computed(() => route.params.id as string)

const { config: viewConfig, error: _configError } = useViewConfig(conceptKey, viewName)

const record = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const currentStatus = ref<string | null>(null)

const statusOptions = ['draft', 'invited', 'confirmed', 'travel_arranged', 'arrived', 'attending', 'departed', 'canceled']

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
  router.push(`/${conceptKey.value}s/${recordId.value}/edit`)
}

async function handleStatusChange(): Promise<void> {
  if (!currentStatus.value || !recordId.value) return
  try {
    await api.put(`/api/domains/${conceptKey.value}/${recordId.value}`, {
      status: currentStatus.value,
    })
    // Reload record to get fresh data + trigger any workflow side effects
    await loadRecord()
  } catch (err) {
    console.error('Status change failed:', err)
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
    error.value = err instanceof Error ? err.message : 'Failed to load record'
  } finally {
    loading.value = false
  }
}

onMounted(loadRecord)
</script>
