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
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/views/shells/ConfigDashboard.vue'),
    meta: { pageConfig: 'gr-dashboard' },
  },
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
    path: '/staff',
    name: 'staff',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'staff', viewName: 'default-list' },
  },
  {
    path: '/schedule',
    name: 'schedule',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'schedule_event', viewName: 'timeline-view' },
  },
  {
    path: '/prep-tracker',
    name: 'prep-tracker',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'prep_item', viewName: 'kanban-tracker' },
  },
  {
    path: '/workflows',
    name: 'workflows',
    component: () => import('@/views/shells/ConfigListPage.vue'),
    meta: { conceptKey: 'workflow_config', viewName: 'default-list' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/shells/DeptSettingsPage.vue'),
    meta: { department: 'guest-relations' },
  },
  {
    path: '/travel',
    name: 'travel',
    component: () => import('@/views/DomainListView.vue'),
    props: { domain: 'travel' },
  },
  {
    path: '/accommodations',
    name: 'accommodations',
    component: () => import('@/views/DomainListView.vue'),
    props: { domain: 'accommodations' },
  },
  {
    path: '/dietary',
    name: 'dietary',
    component: () => import('@/views/DomainListView.vue'),
    props: { domain: 'dietary' },
  },
  {
    path: '/autographs',
    name: 'autographs',
    component: () => import('@/views/DomainListView.vue'),
    props: { domain: 'autographs' },
  },
  {
    path: '/venues',
    name: 'venues',
    component: () => import('@/views/DomainListView.vue'),
    props: { domain: 'venues' },
  },
  {
    path: '/pairings',
    name: 'pairings',
    component: () => import('@/views/DomainListView.vue'),
    props: { domain: 'pairings' },
  },
  {
    path: '/canvas',
    name: 'canvas',
    component: () => import('@/views/SystemGraphView.vue'),
  },
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
