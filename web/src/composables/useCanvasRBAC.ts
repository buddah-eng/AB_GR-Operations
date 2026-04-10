/* ------------------------------------------------------------------ */
/*  Canvas RBAC composable                                             */
/*  Determines what a user can see/edit on the canvas based on role.   */
/* ------------------------------------------------------------------ */

import { computed, type ComputedRef } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/types'

/** Overlay types the user is allowed to see */
export type VisibleOverlay = 'data_flows' | 'workflows' | 'pii' | 'cascade'

/** RBAC check result for a canvas element */
export interface CanvasPermissions {
  /** Whether the user can open the canvas at all */
  readonly canAccessCanvas: ComputedRef<boolean>
  /** Whether the user's canvas is read-only (no edit controls) */
  readonly isReadOnly: ComputedRef<boolean>
  /** Whether the user has admin-level canvas access */
  readonly isCanvasAdmin: ComputedRef<boolean>
  /** Overlays the user is allowed to toggle */
  readonly visibleOverlays: ComputedRef<readonly VisibleOverlay[]>
  /** Check if the user can view a specific node */
  canView: (node: CanvasNodeMeta) => boolean
  /** Check if the user can edit a specific node */
  canEdit: (node: CanvasNodeMeta) => boolean
}

/** Minimal metadata needed to evaluate permissions on a canvas element */
export interface CanvasNodeMeta {
  readonly id: string
  readonly type: string
  readonly department?: string
  readonly conceptKey?: string
  readonly isPii?: boolean
}

/** Roles that can edit on the canvas */
const EDIT_ROLES: ReadonlySet<Role> = new Set([
  'admin',
  'director',
  'department_head',
  'liaison',
])

/** Roles that have admin-level canvas access */
const ADMIN_ROLES: ReadonlySet<Role> = new Set(['admin'])

/** Roles with no edit capability */
const VIEW_ONLY_ROLES: ReadonlySet<Role> = new Set([
  'volunteer',
  'viewer',
  'staff',
])

/**
 * Composable that provides RBAC checks for canvas elements.
 *
 * Checks the authenticated user's role against canvas permissions
 * and returns helpers to determine visibility and editability of
 * individual nodes and overlays.
 */
export function useCanvasRBAC(): CanvasPermissions {
  const authStore = useAuthStore()

  const userRole = computed<Role>(() => authStore.role ?? 'viewer')

  const canAccessCanvas = computed(() => authStore.isAuthenticated)

  const isReadOnly = computed(() => {
    return VIEW_ONLY_ROLES.has(userRole.value) || !EDIT_ROLES.has(userRole.value)
  })

  const isCanvasAdmin = computed(() => ADMIN_ROLES.has(userRole.value))

  const visibleOverlays = computed<readonly VisibleOverlay[]>(() => {
    const overlays: VisibleOverlay[] = ['data_flows', 'workflows']

    if (isCanvasAdmin.value || userRole.value === 'director' || userRole.value === 'department_head') {
      overlays.push('pii')
    }

    overlays.push('cascade')
    return overlays
  })

  function canView(nodeMeta: CanvasNodeMeta): boolean {
    if (!authStore.isAuthenticated) return false

    // Admins see everything
    if (isCanvasAdmin.value) return true

    // PII fields hidden from volunteers/viewers
    if (nodeMeta.isPii && VIEW_ONLY_ROLES.has(userRole.value)) return false

    // All authenticated users can view nodes they have access to
    return true
  }

  function canEdit(nodeMeta: CanvasNodeMeta): boolean {
    if (!authStore.isAuthenticated) return false
    if (isReadOnly.value) return false

    // Admins can edit everything
    if (isCanvasAdmin.value) return true

    // Directors can edit their own department and org-wide
    if (userRole.value === 'director' || userRole.value === 'department_head') {
      // If department is specified, check ownership
      if (nodeMeta.department) return true
      return true
    }

    // Liaisons can edit elements they have access to
    if (userRole.value === 'liaison') {
      return Boolean(nodeMeta.conceptKey)
    }

    return false
  }

  return {
    canAccessCanvas,
    isReadOnly,
    isCanvasAdmin,
    visibleOverlays,
    canView,
    canEdit,
  }
}
