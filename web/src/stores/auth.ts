import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '@/firebase'
import { api } from '@/api/client'
import type { Role } from '@/types'

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true' || !import.meta.env.VITE_FIREBASE_API_KEY

export const useAuthStore = defineStore('auth', () => {
  /* ---- state ---- */
  const user = ref<User | null>(null)
  const role = ref<Role | null>(null)
  const loading = ref(!DEV_BYPASS)
  const initialized = ref(false)
  const error = ref<string | null>(null)

  /* ---- getters ---- */
  const isAuthenticated = computed(() => DEV_BYPASS || user.value !== null)
  const userEmail = computed(() => DEV_BYPASS ? 'dev@localhost' : (user.value?.email ?? ''))
  const displayName = computed(() => DEV_BYPASS ? 'Dev User' : (user.value?.displayName ?? ''))
  const photoURL = computed(() => user.value?.photoURL ?? '')

  /* ---- actions ---- */

  function init(): void {
    if (initialized.value) return
    initialized.value = true

    // In dev bypass mode, skip Firebase auth entirely
    if (DEV_BYPASS) {
      role.value = 'director'
      loading.value = false
      return
    }

    if (!auth) {
      loading.value = false
      return
    }

    onAuthStateChanged(auth, async (firebaseUser) => {
      user.value = firebaseUser
      loading.value = false

      if (firebaseUser) {
        try {
          const result = await api.call<{ role: Role }>('getUserRole')
          role.value = result.role ?? 'viewer'
        } catch {
          // If role fetch fails, default to viewer
          role.value = 'viewer'
        }
      } else {
        role.value = null
      }
    })

    // Handle redirect result
    getRedirectResult(auth).catch((err: unknown) => {
      const firebaseErr = err as Record<string, unknown>
      const message =
        err instanceof Error ? err.message : 'Sign-in redirect failed'
      error.value = `Auth error: ${(firebaseErr.code as string) ?? 'unknown'} - ${message}`
    })
  }

  async function signIn(): Promise<void> {
    error.value = null
    await signInWithRedirect(auth, googleProvider)
  }

  async function signOut(): Promise<void> {
    try {
      error.value = null
      await firebaseSignOut(auth)
      role.value = null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-out failed'
      error.value = message
      throw new Error(message)
    }
  }

  async function getIdToken(): Promise<string> {
    const currentUser = auth.currentUser
    if (!currentUser) {
      throw new Error('No authenticated user')
    }
    return currentUser.getIdToken()
  }

  return {
    // state
    user,
    role,
    loading,
    initialized,
    error,
    // getters
    isAuthenticated,
    userEmail,
    displayName,
    photoURL,
    // actions
    init,
    signIn,
    signOut,
    getIdToken,
  }
})
