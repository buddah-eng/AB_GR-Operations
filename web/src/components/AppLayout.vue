<template>
  <div class="al-root">
    <!-- Sidebar -->
    <aside
      :class="[
        'al-sidebar',
        sidebarVisible ? 'al-sidebar--open' : '',
      ]"
      role="navigation"
      aria-label="Main navigation"
    >
      <!-- Brand header with logo -->
      <div class="al-brand">
        <img
          :src="appStore.conventionLogoUrl"
          :alt="appStore.conventionName"
          class="al-brand-logo"
        />
        <div class="al-brand-text">
          <div class="al-brand-name">GR-Ops</div>
          <div class="al-brand-convention">{{ appStore.conventionName }}</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="al-nav">
        <div v-for="group in navGroups" :key="group.label" class="al-nav-group">
          <div class="al-nav-group-label">{{ group.label }}</div>
          <router-link
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            custom
            v-slot="{ navigate: go, isActive }"
          >
            <a
              href="#"
              :class="[
                'al-nav-link',
                isActive ? 'al-nav-link--active' : '',
              ]"
              @click.prevent="handleNavClick(go)"
            >
              <i :class="[item.icon, 'al-nav-icon']" aria-hidden="true" />
              <span class="al-nav-label">{{ item.label }}</span>
              <span
                v-if="isActive"
                class="al-nav-indicator"
                aria-hidden="true"
              />
            </a>
          </router-link>
        </div>
      </nav>

      <!-- User footer -->
      <div class="al-user">
        <div class="al-user-inner">
          <div class="al-avatar" aria-hidden="true">{{ avatarLabel }}</div>
          <div class="al-user-info">
            <div class="al-user-name">{{ authStore.displayName || authStore.userEmail }}</div>
            <div class="al-user-role">{{ authStore.role ?? 'viewer' }}</div>
          </div>
          <button
            class="al-signout"
            title="Sign out"
            aria-label="Sign out"
            @click="handleSignOut"
          >
            <i class="pi pi-sign-out" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Mobile overlay -->
    <div
      v-if="sidebarVisible"
      class="al-overlay"
      @click="appStore.toggleSidebar()"
    />

    <!-- Main content -->
    <div class="al-main">
      <!-- Top bar -->
      <header class="al-topbar">
        <Button
          icon="pi pi-bars"
          text
          rounded
          size="small"
          class="al-menu-toggle"
          aria-label="Toggle menu"
          @click="appStore.toggleSidebar()"
        />
        <div class="al-topbar-spacer" />
      </header>

      <!-- Page content -->
      <main class="al-content">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

interface NavItem {
  label: string
  icon: string
  to: string
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const router = useRouter()
const authStore = useAuthStore()
const appStore = useAppStore()

const sidebarVisible = computed(() => appStore.sidebarOpen)

const avatarLabel = computed(() => {
  const name = authStore.displayName || authStore.userEmail
  return name ? name.charAt(0).toUpperCase() : '?'
})

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', icon: 'pi pi-th-large', to: '/dashboard' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Guests', icon: 'pi pi-star', to: '/guests' },
      { label: 'Staff', icon: 'pi pi-users', to: '/staff' },
      { label: 'Pairings', icon: 'pi pi-arrows-h', to: '/pairings' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Schedule', icon: 'pi pi-calendar', to: '/schedule' },
      { label: 'Prep Tracker', icon: 'pi pi-check-square', to: '/prep-tracker' },
      { label: 'Travel', icon: 'pi pi-car', to: '/travel' },
    ],
  },
  {
    label: 'Guest Services',
    items: [
      { label: 'Venues', icon: 'pi pi-map', to: '/venues' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { label: 'System Graph', icon: 'pi pi-share-alt', to: '/canvas' },
      { label: 'Workflows', icon: 'pi pi-sitemap', to: '/workflows' },
      { label: 'Settings', icon: 'pi pi-cog', to: '/settings' },
    ],
  },
]

function handleNavClick(go: () => void): void {
  go()
  if (window.innerWidth < 1024) {
    appStore.sidebarOpen = false
  }
}

async function handleSignOut(): Promise<void> {
  try {
    await authStore.signOut()
    router.push({ name: 'login' })
  } catch {
    // Error is stored in authStore.error
  }
}
</script>

<style scoped>
/* Layout root */
.al-root {
  display: flex;
  min-height: 100vh;
  background: var(--bg-page);
}

/* ---- Sidebar ---- */
.al-sidebar {
  position: fixed;
  left: 0;
  top: 0;
  height: 100%;
  width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: var(--z-overlay);
  background: linear-gradient(180deg, var(--primary-700), var(--primary-900));
  color: var(--text-inverse);
  transition: width var(--duration-normal) var(--ease-default);
}

.al-sidebar--open {
  width: 15rem;
}

@media (min-width: 1024px) {
  .al-sidebar {
    width: 15rem;
    translate: 0;
  }
}

/* Brand */
.al-brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  flex-shrink: 0;
}

.al-brand-logo {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-lg);
  object-fit: cover;
  box-shadow: var(--shadow-md);
  flex-shrink: 0;
}

.al-brand-name {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-wide);
  color: var(--surface-0);
}

.al-brand-convention {
  font-family: var(--font-display);
  font-size: 0.625rem;
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent-300);
}

/* Navigation */
.al-nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.al-nav-group-label {
  padding: 0 var(--space-3);
  margin-bottom: var(--space-1);
  font-family: var(--font-display);
  font-size: 0.625rem;
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.4);
}

.al-nav-link {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  font-family: var(--font-display);
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.75);
  text-decoration: none;
  transition: all var(--duration-fast) var(--ease-default);
  margin-bottom: 2px;
  border-left: 2px solid transparent;
}

.al-nav-link:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--surface-0);
}

.al-nav-link--active {
  background: rgba(255, 255, 255, 0.1);
  color: var(--surface-0);
  font-weight: var(--weight-semibold);
  border-left-color: var(--accent-400);
}

.al-nav-icon {
  width: 1rem;
  text-align: center;
  margin-right: var(--space-3);
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.al-nav-link--active .al-nav-icon {
  color: var(--accent-300);
}

.al-nav-indicator {
  margin-left: auto;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: var(--radius-full);
  background: var(--accent-400);
  flex-shrink: 0;
}

/* User footer */
.al-user {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  flex-shrink: 0;
}

.al-user-inner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.al-avatar {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-full);
  background: rgba(var(--accent-400), 0.2);
  background-color: rgba(251, 191, 36, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 0.6875rem;
  font-weight: var(--weight-semibold);
  color: var(--accent-300);
  flex-shrink: 0;
}

.al-user-info {
  min-width: 0;
  flex: 1;
}

.al-user-name {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.al-user-role {
  font-size: 0.625rem;
  color: rgba(255, 255, 255, 0.45);
  text-transform: capitalize;
}

.al-signout {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-md);
  transition: color var(--duration-normal) var(--ease-default);
  display: flex;
  align-items: center;
  justify-content: center;
}

.al-signout:hover {
  color: var(--accent-300);
}

.al-signout:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 2px;
}

.al-signout .pi {
  font-size: var(--text-xs);
}

/* Mobile overlay */
.al-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  z-index: var(--z-overlay);
}

@media (min-width: 1024px) {
  .al-overlay {
    display: none;
  }
}

/* Main content area */
.al-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  transition: margin-left var(--duration-normal) var(--ease-default);
}

@media (min-width: 1024px) {
  .al-main {
    margin-left: 15rem;
  }
}

/* Top bar */
.al-topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: var(--border-thin) solid var(--border-color);
  padding: var(--space-3) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.al-menu-toggle {
  display: flex;
}

@media (min-width: 1024px) {
  .al-menu-toggle {
    display: none;
  }
}

.al-topbar-spacer {
  flex: 1;
}

/* Content */
.al-content {
  flex: 1;
  padding: var(--space-4);
}

@media (min-width: 1024px) {
  .al-content {
    padding: var(--space-6);
  }
}
</style>
