<template>
  <div class="flex min-h-screen bg-primary-50">
    <!-- Sidebar -->
    <aside
      :class="[
        'fixed left-0 top-0 h-full flex flex-col z-40',
        'transition-all duration-200 overflow-hidden',
        'bg-gradient-to-b from-primary-600 to-primary-800 text-white',
        sidebarVisible ? 'w-60' : 'w-0',
        'lg:translate-x-0 lg:w-60',
      ]"
    >
      <!-- Brand header with logo -->
      <div class="px-4 py-3 border-b border-white/15 flex items-center gap-3">
        <img
          :src="appStore.conventionLogoUrl"
          :alt="appStore.conventionName"
          class="w-10 h-10 rounded-lg object-cover shadow-md shrink-0"
        />
        <div>
          <div class="text-sm font-bold tracking-wide font-display text-white">GR-Ops</div>
          <div class="text-[10px] text-accent-300 uppercase tracking-widest font-semibold">{{ appStore.conventionName }}</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        <div v-for="group in navGroups" :key="group.label">
          <div class="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            {{ group.label }}
          </div>
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
                'flex items-center px-3 py-2 rounded-lg text-[13px] transition-all duration-150 mb-0.5',
                isActive
                  ? 'bg-accent-400/20 text-white font-semibold border-l-2 border-accent-400'
                  : 'text-white/80 hover:bg-white/10 hover:text-white',
              ]"
              @click.prevent="handleNavClick(go)"
            >
              <i
                :class="[
                  item.icon,
                  'mr-2.5 text-sm w-4 text-center',
                  isActive ? 'text-accent-300' : '',
                ]"
              />
              {{ item.label }}
              <span
                v-if="isActive"
                class="ml-auto w-1.5 h-1.5 rounded-full bg-accent-400"
              />
            </a>
          </router-link>
        </div>
      </nav>

      <!-- User footer -->
      <div class="px-4 py-3 border-t border-white/15 text-xs">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-full bg-accent-400/25 flex items-center justify-center text-[11px] font-semibold shrink-0 text-accent-300">
            {{ avatarLabel }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-white/90 text-[11px]">{{ authStore.displayName || authStore.userEmail }}</div>
            <div class="text-white/50 text-[10px] capitalize">{{ authStore.role ?? 'viewer' }}</div>
          </div>
          <button
            class="text-white/50 hover:text-accent-300 transition-colors p-1"
            title="Sign out"
            @click="handleSignOut"
          >
            <i class="pi pi-sign-out text-xs" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Mobile overlay -->
    <div
      v-if="sidebarVisible"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
      @click="appStore.toggleSidebar()"
    />

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-h-screen transition-all duration-200 lg:ml-60">
      <!-- Top bar -->
      <header class="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-surface-200 px-4 py-2.5 flex items-center gap-3">
        <Button
          icon="pi pi-bars"
          text
          rounded
          size="small"
          class="lg:hidden"
          aria-label="Toggle menu"
          @click="appStore.toggleSidebar()"
        />
        <div class="flex-1" />
      </header>

      <!-- Page content -->
      <main class="flex-1 p-4 lg:p-6">
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
      { label: 'Accommodations', icon: 'pi pi-building', to: '/accommodations' },
    ],
  },
  {
    label: 'Guest Services',
    items: [
      { label: 'Dietary', icon: 'pi pi-heart', to: '/dietary' },
      { label: 'Autographs', icon: 'pi pi-pencil', to: '/autographs' },
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
