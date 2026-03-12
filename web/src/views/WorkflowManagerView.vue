<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-surface-800">Workflows</h1>
    </div>

    <Card>
      <template #content>
        <div class="text-center py-12">
          <i class="pi pi-sitemap text-5xl text-surface-300 mb-4" />
          <h2 class="text-lg font-semibold text-surface-700 mb-2">
            Workflow Manager
          </h2>
          <p class="text-sm text-surface-400 max-w-md mx-auto">
            Automated workflows for guest onboarding, prep tracking, and
            notifications will be configured here. This feature is under
            development.
          </p>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import Card from 'primevue/card'
</script>
