<template>
  <DynamicView
    v-if="viewConfig"
    :config="viewConfig"
    :data="records"
    :total-records="total"
    :loading="dataLoading"
    :error="viewError ?? dataError"
    @row-click="handleRowClick"
  />
  <div v-else-if="viewLoading" class="animate-pulse space-y-3">
    <div class="h-8 bg-surface-200 rounded" v-for="n in 3" :key="n" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import DynamicView from '@/components/views/DynamicView.vue'
import { useViewConfig } from '@/composables/useViewConfig'
import { useConceptData } from '@/composables/useConceptData'

const props = defineProps<{
  conceptKey: string
  viewName: string
  filter?: Record<string, string>
}>()

const router = useRouter()

const { config: viewConfig, loading: viewLoading, error: viewError } = useViewConfig(
  props.conceptKey,
  props.viewName
)

const filterOptions = computed(() => ({
  filters: props.filter as Record<string, unknown> | undefined,
}))

const { records, loading: dataLoading, error: dataError, total } = useConceptData(
  props.conceptKey,
  filterOptions
)

function handleRowClick(record: Record<string, unknown>): void {
  const id = record.id as string
  if (id) {
    router.push(`/${props.conceptKey}s/${id}`)
  }
}
</script>
