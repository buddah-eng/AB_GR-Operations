<template>
  <div class="min-h-screen bg-gradient-to-br from-ab-700 via-ab-600 to-ab-500 flex items-center justify-center p-4 relative overflow-hidden">
    <!-- Decorative background shapes -->
    <div class="absolute inset-0 overflow-hidden pointer-events-none">
      <div class="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-accent-400/15 blur-3xl" />
      <div class="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-ab-300/20 blur-3xl" />
      <div class="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-accent-300/10 blur-2xl" />
    </div>

    <Card class="w-full max-w-sm text-center relative z-10 shadow-2xl border-0">
      <template #content>
        <div class="mb-8">
          <!-- AB Logo from brand asset -->
          <div class="flex justify-center mb-5">
            <img
              src="/ab-logo.jpg"
              alt="Anime Boston 2026"
              class="w-48 h-auto rounded-xl shadow-lg"
            />
          </div>
          <h1 class="text-2xl font-bold text-surface-900 font-display">GR-Ops</h1>
          <p class="text-sm text-surface-500 mt-1 font-sans">Guest Relations Operations</p>
        </div>

        <Button
          :label="signingIn ? 'Signing in...' : 'Sign in with Google'"
          :icon="signingIn ? 'pi pi-spin pi-spinner' : 'pi pi-google'"
          :disabled="signingIn"
          :loading="signingIn"
          class="w-full"
          outlined
          @click="handleSignIn"
        />

        <Message
          v-if="authStore.error"
          severity="error"
          class="mt-4"
          :closable="false"
        >
          {{ authStore.error }}
        </Message>

        <p class="mt-6 text-xs text-surface-400">
          Access restricted to authorized Anime Boston staff
        </p>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const signingIn = ref(false)

async function handleSignIn(): Promise<void> {
  signingIn.value = true
  try {
    await authStore.signIn()
  } catch {
    // Error already captured in authStore.error
  } finally {
    signingIn.value = false
  }
}
</script>
