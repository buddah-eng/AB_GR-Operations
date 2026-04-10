<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
        {{ pageTitle }}
      </h1>
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
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DynamicForm from '@/components/forms/DynamicForm.vue'
import { useFormConfig } from '@/composables/useFormConfig'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'

const route = useRoute()
const router = useRouter()
const ontologyStore = useOntologyStore()

const conceptKey = computed(() => (route.meta.conceptKey as string) ?? '')
const formName = computed(() => (route.meta.formName as string) ?? 'default')

const { config: formConfig, loading: configLoading, error: configError } = useFormConfig(conceptKey, formName)

const concept = computed(() => ontologyStore.getConceptByKey(conceptKey.value))
const pageTitle = computed(() => `New ${concept.value?.label ?? conceptKey.value}`)
const properties = computed(() => ontologyStore.getPropertiesForConcept(conceptKey.value))
const initialValues = computed(() => ({}))

const submitting = ref(false)

async function handleSubmit(values: Record<string, unknown>): Promise<void> {
  submitting.value = true
  try {
    await api.post(`/api/domains/${conceptKey.value}`, values)
    router.push(`/${conceptKey.value}s`)
  } catch (err) {
    console.error('Form submission failed:', err)
  } finally {
    submitting.value = false
  }
}

function handleCancel(): void {
  router.back()
}
</script>
