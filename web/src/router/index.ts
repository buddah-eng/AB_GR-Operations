import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/* ------------------------------------------------------------------ */
/*  Route definitions                                                  */
/* ------------------------------------------------------------------ */

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { requiresAuth: false },
  },

  // --- Overview ---
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/shells/ConfigDashboard.vue'),
    meta: { pageConfig: 'gr-dashboard' },
  },

  // --- Guests (full CRUD) ---
  {
    path: '/guests',
    name: 'guests',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'default-list' },
  },
  {
    path: '/guests/new',
    name: 'new-guest',
    component: () => import('@/views/shells/ConfigFormPage.vue'),
    meta: { conceptKey: 'guest', formName: 'intake-wizard' },
  },
  {
    path: '/guests/:id',
    name: 'guest-detail',
    component: () => import('@/views/shells/ConfigDetailPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'detail-view' },
    props: true,
  },
  {
    path: '/guests/:id/edit',
    name: 'edit-guest',
    component: () => import('@/views/shells/ConfigFormPage.vue'),
    meta: { conceptKey: 'guest', formName: 'quick-edit' },
    props: true,
  },

  // --- Staff ---
  {
    path: '/staff',
    name: 'staff',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'staff', viewName: 'default-list' },
  },
  {
    path: '/staff/:id',
    name: 'staff-detail',
    component: () => import('@/views/shells/ConfigDetailPage.vue'),
    meta: { conceptKey: 'staff', viewName: 'detail-view' },
    props: true,
  },

  // --- Pairings (config-driven, not DomainListView) ---
  {
    path: '/pairings',
    name: 'pairings',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'pairing', viewName: 'default-list' },
  },

  // --- Schedule ---
  {
    path: '/schedule',
    name: 'schedule',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'schedule', viewName: 'timeline-view' },
  },
  {
    path: '/schedule/:id',
    name: 'schedule-detail',
    component: () => import('@/views/shells/ConfigDetailPage.vue'),
    meta: { conceptKey: 'schedule', viewName: 'detail-view' },
    props: true,
  },

  // --- Prep Tracker ---
  {
    path: '/prep-tracker',
    name: 'prep-tracker',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'prep_item', viewName: 'kanban-tracker' },
  },
  {
    path: '/prep-tracker/:id',
    name: 'prep-detail',
    component: () => import('@/views/shells/ConfigDetailPage.vue'),
    meta: { conceptKey: 'prep_item', viewName: 'detail-view' },
    props: true,
  },

  // --- Travel / Transport (config-driven, maps to transport_booking) ---
  {
    path: '/travel',
    name: 'travel',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'transport', viewName: 'default-list' },
  },

  // --- Venues (config-driven) ---
  {
    path: '/venues',
    name: 'venues',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'venue', viewName: 'default-list' },
  },

  // --- Guest services: these are guest properties, not separate concepts ---
  // Show as filtered guest list views
  {
    path: '/accommodations',
    name: 'accommodations',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'default-list' },
  },
  {
    path: '/dietary',
    name: 'dietary',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'default-list' },
  },
  {
    path: '/autographs',
    name: 'autographs',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'guest', viewName: 'default-list' },
  },

  // --- Workflows ---
  {
    path: '/workflows',
    name: 'workflows',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'workflow', viewName: 'default-list' },
  },

  // --- Settings ---
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/shells/DeptSettingsPage.vue'),
    meta: { department: 'guest-relations' },
  },

  // --- Canvas ---
  {
    path: '/canvas',
    name: 'canvas',
    component: () => import('@/views/SystemGraphView.vue'),
  },
  {
    path: '/canvas/workflow/:id',
    name: 'workflow-canvas',
    component: () => import('@/views/WorkflowCanvasView.vue'),
    props: true,
  },
  {
    path: '/canvas/data-flows',
    name: 'data-flow-canvas',
    component: () => import('@/views/DataFlowCanvasView.vue'),
  },

  // --- Builders ---
  {
    path: '/builder/form/:conceptKey',
    name: 'form-builder',
    component: () => import('@/components/builders/FormBuilder.vue'),
    props: true,
  },
  {
    path: '/builder/view/:conceptKey',
    name: 'view-builder',
    component: () => import('@/components/builders/ViewBuilder.vue'),
    props: true,
  },
  {
    path: '/builder/workflow/:id?',
    name: 'workflow-builder',
    component: () => import('@/components/builders/WorkflowBuilder.vue'),
    props: true,
  },

  // --- Catch-all ---
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard',
  },
]

/* ------------------------------------------------------------------ */
/*  Router instance                                                    */
/* ------------------------------------------------------------------ */

const router = createRouter({
  history: createWebHistory(),
  routes,
})

/* ------------------------------------------------------------------ */
/*  Navigation guard: require auth on all routes except /login         */
/* ------------------------------------------------------------------ */

router.beforeEach((to) => {
  const authStore = useAuthStore()

  // Allow login page without auth
  if (to.meta.requiresAuth === false) {
    // If already authenticated, redirect to dashboard
    if (authStore.isAuthenticated) {
      return { name: 'dashboard' }
    }
    return true
  }

  // All other routes require auth
  if (!authStore.isAuthenticated && !authStore.loading) {
    return { name: 'login' }
  }

  return true
})

export default router
