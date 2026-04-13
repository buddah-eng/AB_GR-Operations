<template>
  <Toast position="top-right" />
  <ConfirmDialog />

  <div v-if="authStore.loading" class="flex items-center justify-center min-h-screen bg-primary-50">
    <ProgressSpinner
      style="width: 50px; height: 50px"
      strokeWidth="4"
      aria-label="Loading application"
    />
  </div>

  <router-view v-else-if="!authStore.isAuthenticated" />

  <AppLayout v-else>
    <router-view />
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import ProgressSpinner from 'primevue/progressspinner'

import AppLayout from '@/components/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { useOntologyStore } from '@/stores/ontology'

const authStore = useAuthStore()
const appStore = useAppStore()
const ontologyStore = useOntologyStore()

onMounted(() => {
  authStore.init()
  appStore.loadConfig()
  // Load ontology eagerly — all config-driven pages depend on it for labels, types, properties
  ontologyStore.loadOntology()
})
</script>
