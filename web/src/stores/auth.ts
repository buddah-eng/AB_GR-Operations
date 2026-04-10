import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, isDemoMode } from '@/api/client'
import type { Role } from '@/types'
import type { User } from 'firebase/auth'

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'

export const useAuthStore = defineStore('auth', () => {
  /* ---- state ---- */
  const user = ref<User | null>(null)
  const role = ref<Role | null>(null)
  const loading = ref(!DEV_BYPASS && !isDemoMode)
  const initialized = ref(false)
  const error = ref<string | null>(null)

  /* ---- getters ---- */
  const isAuthenticated = computed(() =>
    isDemoMode || DEV_BYPASS || user.value !== null,
  )
  const userEmail = computed(() => {
    if (isDemoMode) return 'demo-director@animeboston.org'
    if (DEV_BYPASS) return 'dev@localhost'
    return user.value?.email ?? ''
  })
  const displayName = computed(() => {
    if (isDemoMode) return 'Demo Director'
    if (DEV_BYPASS) return 'Dev User'
    return user.value?.displayName ?? ''
  })
  const photoURL = computed(() => user.value?.photoURL ?? '')

  /* ---- actions ---- */

  function init(): void {
    if (initialized.value) return
    initialized.value = true

    // In demo mode, skip Firebase auth entirely
    if (isDemoMode) {
      role.value = 'director'
      loading.value = false
      return
    }

    // In dev bypass mode, skip Firebase auth entirely
    if (DEV_BYPASS) {
      role.value = 'director'
      loading.value = false
      return
    }

    // Dynamically import Firebase auth to avoid loading it in demo mode
    import('firebase/auth').then(({ onAuthStateChanged, getRedirectResult }) => {
      import('@/firebase').then(({ auth, googleProvider: _gp }) => {
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
      })
    })
  }

  async function signIn(): Promise<void> {
    if (isDemoMode) return

    error.value = null
    const { signInWithRedirect } = await import('firebase/auth')
    const { auth, googleProvider } = await import('@/firebase')
    await signInWithRedirect(auth, googleProvider)
  }

  async function signOut(): Promise<void> {
    if (isDemoMode) return

    try {
      error.value = null
      const { signOut: firebaseSignOut } = await import('firebase/auth')
      const { auth } = await import('@/firebase')
      await firebaseSignOut(auth)
      role.value = null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-out failed'
      error.value = message
      throw new Error(message)
    }
  }

  async function getIdToken(): Promise<string> {
    if (isDemoMode) return 'demo-token'

    const { auth } = await import('@/firebase')
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
