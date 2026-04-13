import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type { Toast, ConfigData } from '@/types'

/* ------------------------------------------------------------------ */
/*  Default config — used when the backend is unavailable              */
/* ------------------------------------------------------------------ */

const DEFAULT_CONFIG: ConfigData = {
  departments: [
    { 'Department Name': 'Anime' },
    { 'Department Name': 'Gaming' },
    { 'Department Name': 'Music' },
    { 'Department Name': 'Cosplay' },
    { 'Department Name': 'Panels' },
    { 'Department Name': 'Artists' },
    { 'Department Name': 'Industry' },
    { 'Department Name': 'To Be Determined' },
  ],
  roles: [
    { 'Role Name': 'Main Liaison' },
    { 'Role Name': 'Backup Liaison' },
    { 'Role Name': 'Interpreter' },
    { 'Role Name': 'Security Escort' },
    { 'Role Name': 'Department Head' },
    { 'Role Name': 'Volunteer' },
  ],
  eventTypes: [
    { 'Type Name': 'Panel' },
    { 'Type Name': 'Autograph Session' },
    { 'Type Name': 'Photo Op' },
    { 'Type Name': 'Meal' },
    { 'Type Name': 'Photoshoot' },
    { 'Type Name': 'Interview' },
    { 'Type Name': 'Rehearsal' },
    { 'Type Name': 'Meet & Greet' },
    { 'Type Name': 'Other' },
  ],
  venues: [
    { 'Venue Name': 'Main Events Hall A' },
    { 'Venue Name': 'Main Events Hall B' },
    { 'Venue Name': 'Panel Room 1' },
    { 'Venue Name': 'Panel Room 2' },
    { 'Venue Name': 'Panel Room 3' },
    { 'Venue Name': 'Autograph Hall' },
    { 'Venue Name': 'Press Room' },
    { 'Venue Name': 'Green Room' },
    { 'Venue Name': 'Restaurant (Hotel)' },
    { 'Venue Name': 'Lobby Meeting Point' },
  ],
  prepTemplates: [],
  constraints: [],
  convention: {
    name: 'Convention',
    startDate: '',
    endDate: '',
    venue: '',
    logoUrl: '/placeholder-logo.svg',
  },
}

/**
 * General-purpose application store.
 * Holds global config, toast notifications, and ephemeral UI state.
 */
export const useAppStore = defineStore('app', () => {
  /* ---- state ---- */
  const config = ref<ConfigData>(DEFAULT_CONFIG)
  const loading = ref(false)
  const sidebarOpen = ref(true)
  const toasts = ref<Toast[]>([])

  let toastId = 0
  const toastTimers = new Map<number, ReturnType<typeof setTimeout>>()

  /* ---- derived ---- */

  const conventionName = computed(() =>
    String(config.value.convention?.['name'] ?? 'Convention'),
  )

  const conventionLogoUrl = computed(() =>
    String(config.value.convention?.['logoUrl'] ?? '/placeholder-logo.svg'),
  )

  /* ---- actions ---- */

  async function loadConfig(): Promise<void> {
    loading.value = true
    try {
      const data = await api.get<ConfigData>('/api/config')
      config.value = data
    } catch {
      // Backend unavailable — keep using defaults
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(partial?: Partial<ConfigData>): Promise<boolean> {
    const payload = partial ?? config.value
    try {
      const saved = await api.post<ConfigData>('/api/config', payload)
      config.value = saved
      return true
    } catch {
      // Save failed — config stays in memory only until next save attempt
      return false
    }
  }

  function addToast(
    message: string,
    type: Toast['type'] = 'info',
    duration = 4000,
  ): void {
    const id = ++toastId
    toasts.value = [...toasts.value, { id, message, type }]
    const timer = setTimeout(() => {
      removeToast(id)
    }, duration)
    toastTimers.set(id, timer)
  }

  function removeToast(id: number): void {
    const timer = toastTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      toastTimers.delete(id)
    }
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
  }

  return {
    config,
    loading,
    sidebarOpen,
    toasts,
    conventionName,
    conventionLogoUrl,
    loadConfig,
    saveConfig,
    addToast,
    removeToast,
    toggleSidebar,
  }
})

/**
 * @deprecated Use `useAppStore()` from pinia instead.
 * Kept for backward compatibility during migration.
 */
export { useAppStore as store }
