<template>
  <div class="space-y-6">
    <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
      {{ deptName }} Settings
    </h1>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Department info -->
      <SettingsCard
        title="Department Info"
        description="Department name, description, and icon"
        icon="pi pi-building"
        :edit-route="{ name: 'form-builder', params: { conceptKey: department } }"
      />

      <!-- Concept properties -->
      <SettingsCard
        v-for="concept in deptConcepts"
        :key="concept.key"
        :title="`${concept.label} Fields`"
        :description="`${propertyCount(concept.key)} properties defined`"
        icon="pi pi-list"
        :edit-route="{ name: 'form-builder', params: { conceptKey: concept.key } }"
      />

      <!-- View configs -->
      <SettingsCard
        title="Views & Layouts"
        description="Configure list, kanban, timeline, and detail views"
        icon="pi pi-th-large"
        :edit-route="{ name: 'view-builder', params: { conceptKey: primaryConcept } }"
      />

      <!-- Workflows -->
      <SettingsCard
        title="Automations"
        description="Workflows triggered by status changes and events"
        icon="pi pi-bolt"
        :edit-route="{ name: 'workflow-builder' }"
      />

      <!-- Roles & Permissions -->
      <SettingsCard
        title="Permissions"
        description="Who can see and edit what"
        icon="pi pi-lock"
      />

      <!-- Integrations -->
      <SettingsCard
        title="Integrations"
        description="Connected external services"
        icon="pi pi-link"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SettingsCard from './SettingsCard.vue'
import { useOntologyStore } from '@/stores/ontology'

const route = useRoute()
const ontologyStore = useOntologyStore()

const department = computed(() => (route.meta.department as string) ?? 'guest-relations')
const deptName = computed(() => {
  const name = department.value.replace(/-/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
})

const deptConcepts = computed(() => {
  const concepts = ontologyStore.concepts ?? []
  return concepts.filter(
    (c: Record<string, unknown>) =>
      (c.department === department.value || c.key === 'guest' || c.key === 'staff') &&
      !c.isConfig
  )
})

const primaryConcept = computed(() => deptConcepts.value[0]?.key ?? 'guest')

function propertyCount(conceptKey: string): number {
  return ontologyStore.getPropertiesForConcept(conceptKey)?.length ?? 0
}
</script>
