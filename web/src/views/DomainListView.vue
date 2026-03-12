<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-surface-800">{{ domainLabel }}</h1>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        severity="secondary"
        size="small"
        :loading="loading"
        @click="loadData"
      />
    </div>

    <Message v-if="!loading && records.length === 0" severity="info" :closable="false">
      No {{ domainLabel.toLowerCase() }} records yet. Records will appear here once created
      via the API or through workflow automation.
    </Message>

    <DataTable
      v-if="records.length > 0"
      :value="records"
      :loading="loading"
      :paginator="records.length > 25"
      :rows="25"
      stripedRows
      :rowHover="true"
      tableStyle="min-width: 40rem"
    >
      <Column
        v-for="col in visibleColumns"
        :key="col.key"
        :field="'properties.' + col.key"
        :header="col.label"
        sortable
      />
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'

const props = defineProps<{ domain: string }>()

const toast = useToast()
const ontologyStore = useOntologyStore()
const loading = ref(false)
const records = ref<Record<string, unknown>[]>([])

const domainLabel = computed(() => {
  const concept = ontologyStore.getConceptByKey(props.domain)
  return concept?.pluralLabel ?? props.domain.charAt(0).toUpperCase() + props.domain.slice(1)
})

const visibleColumns = computed(() => {
  const conceptProps = ontologyStore.getPropertiesForConcept(props.domain)
  return conceptProps.slice(0, 8)
})

function loadData(): void {
  loading.value = true
  api.get<{ data: Record<string, unknown>[] }>(`/api/domains/${props.domain}`)
    .then((result) => {
      // The REST endpoint wraps records in { data: [...] }
      records.value = Array.isArray(result) ? result : (result?.data ?? [])
    })
    .catch((err: Error) => {
      // Graceful degradation — show empty state, not a crash
      records.value = []
      toast.add({
        severity: 'warn',
        summary: 'Data Unavailable',
        detail: `Could not load ${domainLabel.value}: ${err.message}`,
        life: 4000,
      })
    })
    .finally(() => {
      loading.value = false
    })
}

watch(() => props.domain, loadData)
onMounted(loadData)
</script>
