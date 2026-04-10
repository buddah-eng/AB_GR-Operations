<template>
  <div class="space-y-6">
    <!-- Back button + title -->
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

const recordTitle = computed(() => {
  if (!record.value) return 'Loading...'
  return (record.value.name as string) ?? (record.value.title as string) ?? recordId.value
})

const tabs = computed<ViewTab[]>(() => viewConfig.value?.tabs ?? [])

function resolveTabFilter(filter: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(filter)) {
    resolved[key] = value === '{{record.id}}' ? recordId.value : value
  }
  return resolved
}

onMounted(async () => {
  try {
    const data = await api.get<Record<string, unknown>>(
      `/api/domains/${conceptKey.value}/${recordId.value}`
    )
    record.value = data
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load record'
  } finally {
    loading.value = false
  }
})
</script>
