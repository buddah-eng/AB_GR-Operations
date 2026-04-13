<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          {{ pageConfig?.name ?? 'Dashboard' }}
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <SelectButton
          v-model="timeScope"
          :options="timeScopeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          aria-label="Dashboard time scope"
        />
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          severity="secondary"
          size="small"
          :loading="refreshing"
          @click="handleRefresh"
        />
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="configLoading" class="grid grid-cols-12 gap-4">
      <div class="col-span-3 h-24 bg-surface-200 rounded-lg animate-pulse" v-for="n in 4" :key="n" />
    </div>

    <!-- Error state -->
    <div v-else-if="configError" class="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
      <p class="text-red-700">{{ configError }}</p>
    </div>

    <!-- Widget grid -->
    <div v-else-if="pageConfig" class="grid grid-cols-12 gap-4">
      <div
        v-for="widget in pageConfig.widgets"
        :key="widget.widgetId"
        class="col-span-12 sm:col-span-6 lg:col-span-4 xl:col-span-3"
      >
        <DashboardWidget :widget="widget" :refreshKey="refreshKey" :timeScope="timeScope" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import DashboardWidget from './DashboardWidget.vue'
import { usePageConfig } from '@/composables/usePageConfig'

type TimeScope = 'all' | 'today'

const TIME_SCOPE_KEY = 'gr-ops:dashboard-time-scope'

const timeScopeOptions = [
  { label: 'All Time', value: 'all' as TimeScope },
  { label: 'Today', value: 'today' as TimeScope },
]

const route = useRoute()
const slug = computed(() => (route.meta.pageConfig as string) ?? 'gr-dashboard')

const { config: pageConfig, loading: configLoading, error: configError, reload } = usePageConfig(slug)

const savedScope = localStorage.getItem(TIME_SCOPE_KEY) as TimeScope | null
const timeScope = ref<TimeScope>(savedScope === 'today' ? 'today' : 'all')

watch(timeScope, (scope) => {
  localStorage.setItem(TIME_SCOPE_KEY, scope)
})

const refreshing = ref(false)
const refreshKey = ref(0)

async function handleRefresh(): Promise<void> {
  refreshing.value = true
  await reload()
  refreshKey.value++
  refreshing.value = false
}
</script>
