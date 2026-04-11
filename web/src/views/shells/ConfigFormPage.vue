<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Button
          v-if="isEditMode"
          icon="pi pi-arrow-left"
          severity="secondary"
          text
          rounded
          @click="router.back()"
          aria-label="Go back"
        />
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          {{ pageTitle }}
        </h1>
      </div>
    </div>

    <div v-if="configLoading" class="animate-pulse space-y-4">
      <div class="h-10 bg-surface-200 rounded w-1/3" />
      <div class="h-10 bg-surface-200 rounded w-2/3" />
      <div class="h-10 bg-surface-200 rounded w-1/2" />
    </div>

    <div v-else-if="configError" class="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
      <p class="text-red-700">{{ configError }}</p>
    </div>

    <DynamicForm
      v-else-if="formConfig"
      :config="formConfig"
      :properties="properties"
      :initial-values="initialValues"
      :loading="submitting"
      @submit="handleSubmit"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import DynamicForm from '@/components/forms/DynamicForm.vue'
import { useFormConfig } from '@/composables/useFormConfig'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const ontologyStore = useOntologyStore()

const conceptKey = computed(() => (route.meta.conceptKey as string) ?? '')
const formName = computed(() => (route.meta.formName as string) ?? 'default')
const recordId = computed(() => route.params.id as string | undefined)
const isEditMode = computed(() => !!recordId.value)

const { config: formConfig, loading: configLoading, error: configError } = useFormConfig(conceptKey, formName)

const concept = computed(() => ontologyStore.getConceptByKey(conceptKey.value))
const pageTitle = computed(() =>
  isEditMode.value
    ? `Edit ${concept.value?.label ?? conceptKey.value}`
    : `New ${concept.value?.label ?? conceptKey.value}`
)
const properties = computed(() => ontologyStore.getPropertiesForConcept(conceptKey.value))

const initialValues = ref<Record<string, unknown>>({})
const submitting = ref(false)
const loadingRecord = ref(false)

// Load existing record for edit mode
onMounted(async () => {
  if (isEditMode.value && recordId.value) {
    loadingRecord.value = true
    try {
      const record = await api.get<Record<string, unknown>>(
        `/api/domains/${conceptKey.value}/${recordId.value}`
      )
      // Merge typed columns and JSONB properties into flat initialValues
      const props = (record.properties ?? {}) as Record<string, unknown>
      initialValues.value = { ...record, ...props }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load record'
      toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
    } finally {
      loadingRecord.value = false
    }
  }
})

async function handleSubmit(values: Record<string, unknown>): Promise<void> {
  submitting.value = true
  try {
    if (isEditMode.value && recordId.value) {
      // Edit: PUT to existing record
      await api.put(`/api/domains/${conceptKey.value}/${recordId.value}`, values)
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Record updated', life: 3000 })
      // Navigate back to the detail page: strip /edit from current path
      const detailPath = route.path.replace(/\/edit$/, '')
      router.push(detailPath)
    } else {
      // Create: POST new record, redirect to detail
      const result = await api.post<Record<string, unknown>>(
        `/api/domains/${conceptKey.value}`,
        values
      )
      toast.add({ severity: 'success', summary: 'Created', detail: 'Record created', life: 3000 })
      const newId = (result as Record<string, unknown>).id as string
      if (newId) {
        // Navigate to detail: strip /new from current path, append /{id}
        const basePath = route.path.replace(/\/new$/, '')
        router.push(`${basePath}/${newId}`)
      } else {
        // Fall back to list page
        const basePath = route.path.replace(/\/new$/, '')
        router.push(basePath)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save'
    toast.add({ severity: 'error', summary: 'Error', detail: message, life: 5000 })
  } finally {
    submitting.value = false
  }
}

function handleCancel(): void {
  router.back()
}
</script>
