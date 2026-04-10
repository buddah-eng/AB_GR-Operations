<template>
  <Toast position="top-right" />
  <ConfirmDialog />

  <DemoBar v-if="isDemoMode" />

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
import { onMounted, defineAsyncComponent } from 'vue'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import ProgressSpinner from 'primevue/progressspinner'

import AppLayout from '@/components/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { isDemoMode } from '@/api/client'

const DemoBar = isDemoMode
  ? defineAsyncComponent(() => import('@/demo/DemoBar.vue'))
  : { render: () => null }

const authStore = useAuthStore()
const appStore = useAppStore()

onMounted(() => {
  authStore.init()
  appStore.loadConfig()
})
</script>
