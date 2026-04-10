<template>
  <div class="lv-root">
    <!-- Decorative background shapes -->
    <div class="lv-bg" aria-hidden="true">
      <div class="lv-bg-orb lv-bg-orb--1" />
      <div class="lv-bg-orb lv-bg-orb--2" />
      <div class="lv-bg-orb lv-bg-orb--3" />
    </div>

    <div class="lv-card">
      <div class="lv-card-inner">
        <!-- Convention logo from config -->
        <div class="lv-logo-wrap">
          <img
            :src="appStore.conventionLogoUrl"
            :alt="appStore.conventionName"
            class="lv-logo"
          />
        </div>

        <h1 class="lv-title">GR-Ops</h1>
        <p class="lv-subtitle">Guest Relations Operations</p>

        <Button
          :label="signingIn ? 'Signing in...' : 'Sign in with Google'"
          :icon="signingIn ? 'pi pi-spin pi-spinner' : 'pi pi-google'"
          :disabled="signingIn"
          :loading="signingIn"
          class="lv-signin-btn"
          outlined
          @click="handleSignIn"
        />

        <div v-if="authStore.error" class="lv-error" role="alert">
          <i class="pi pi-exclamation-triangle lv-error-icon" aria-hidden="true" />
          <span class="lv-error-text">{{ authStore.error }}</span>
        </div>

        <p class="lv-footer">
          Access restricted to authorized {{ appStore.conventionName }} staff
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

const authStore = useAuthStore()
const appStore = useAppStore()
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

<style scoped>
/* Full-screen login */
.lv-root {
  min-height: 100vh;
  background: linear-gradient(135deg, var(--primary-800), var(--primary-600), var(--primary-500));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  position: relative;
  overflow: hidden;
}

/* Decorative background */
.lv-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.lv-bg-orb {
  position: absolute;
  border-radius: var(--radius-full);
  filter: blur(80px);
}

.lv-bg-orb--1 {
  top: -8rem;
  right: -8rem;
  width: 24rem;
  height: 24rem;
  background: rgba(251, 191, 36, 0.12);
}

.lv-bg-orb--2 {
  bottom: -6rem;
  left: -6rem;
  width: 20rem;
  height: 20rem;
  background: rgba(148, 163, 184, 0.15);
}

.lv-bg-orb--3 {
  top: 33%;
  right: 25%;
  width: 16rem;
  height: 16rem;
  background: rgba(251, 191, 36, 0.08);
}

/* Card */
.lv-card {
  width: 100%;
  max-width: 24rem;
  background: var(--bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  position: relative;
  z-index: 1;
  overflow: hidden;
}

.lv-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent-400), var(--primary-400));
}

.lv-card-inner {
  padding: var(--space-10) var(--space-8) var(--space-8);
  text-align: center;
}

/* Logo */
.lv-logo-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-6);
}

.lv-logo {
  width: 12rem;
  height: auto;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
}

/* Typography */
.lv-title {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--weight-black);
  color: var(--text-primary);
  letter-spacing: var(--tracking-display);
  margin: 0;
}

.lv-subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: var(--space-1) 0 var(--space-8);
}

/* Sign in button */
.lv-signin-btn {
  width: 100%;
}

/* Error */
.lv-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding: var(--space-3);
  background: var(--color-error-bg);
  border: var(--border-thin) solid var(--color-error-bg-border);
  border-radius: var(--radius-lg);
  text-align: left;
}

.lv-error-icon {
  color: var(--color-error);
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.lv-error-text {
  font-size: var(--text-sm);
  color: var(--color-error-text);
}

/* Footer */
.lv-footer {
  margin: var(--space-8) 0 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
