<template>
  <div class="demo-bar">
    <div class="demo-bar-inner">
      <span class="demo-indicator">DEMO MODE</span>

      <div class="demo-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          :class="['demo-tab', { active: currentTab === tab.value }]"
          @click="selectTab(tab.value)"
        >
          <i :class="tab.icon" />
          {{ tab.label }}
        </button>
      </div>

      <span class="demo-convention">Anime Boston 2026</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDemoState, type DemoTimeState } from './demo-state'

interface DemoTab {
  readonly value: DemoTimeState | 'how-built'
  readonly label: string
  readonly icon: string
}

const tabs: readonly DemoTab[] = [
  { value: 'pre-event', label: 'Pre-Event', icon: 'pi pi-calendar-plus' },
  { value: 'during-event', label: 'During Event', icon: 'pi pi-bolt' },
  { value: 'post-event', label: 'Post-Event', icon: 'pi pi-chart-bar' },
  { value: 'how-built', label: 'How It\'s Built', icon: 'pi pi-cog' },
]

const router = useRouter()
const currentTab = ref<DemoTimeState | 'how-built'>('pre-event')
const demoState = useDemoState()

function selectTab(tab: DemoTimeState | 'how-built'): void {
  currentTab.value = tab

  if (tab === 'how-built') {
    router.push({ name: 'canvas' })
    return
  }

  demoState.setTimeState(tab)

  // Force-refresh by navigating to dashboard with a query param change
  // This triggers route change → component remount → data reload
  router.push({ name: 'dashboard', query: { t: tab } })
}
</script>

<style scoped>
.demo-bar {
  position: sticky;
  top: 0;
  z-index: var(--z-toast, 500);
  background: linear-gradient(135deg, var(--primary-900, #0f172a), var(--primary-800, #1e293b));
  border-bottom: 2px solid var(--accent-400, #fbbf24);
  box-shadow: var(--shadow-md, 0 4px 6px -1px rgba(0, 0, 0, 0.1));
}

.demo-bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1rem;
  height: 42px;
  gap: 1rem;
}

.demo-indicator {
  font-family: var(--font-display, 'M PLUS 1', sans-serif);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--accent-400, #fbbf24);
  background: rgba(251, 191, 36, 0.12);
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-full, 9999px);
  border: 1px solid rgba(251, 191, 36, 0.3);
  white-space: nowrap;
  flex-shrink: 0;
}

.demo-tabs {
  display: flex;
  gap: 0.25rem;
}

.demo-tab {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.75rem;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  background: transparent;
  color: var(--primary-300, #cbd5e1);
  font-family: var(--font-display, 'M PLUS 1', sans-serif);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;
}

.demo-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--surface-0, #ffffff);
}

.demo-tab.active {
  background: rgba(255, 255, 255, 0.15);
  color: var(--accent-400, #fbbf24);
}

.demo-tab i {
  font-size: 0.8rem;
}

.demo-convention {
  font-family: var(--font-display, 'M PLUS 1', sans-serif);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--primary-400, #94a3b8);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Responsive: hide labels on small screens */
@media (max-width: 640px) {
  .demo-tab {
    padding: 0.35rem 0.5rem;
    font-size: 0;
    min-height: 44px;
    min-width: 44px;
  }

  .demo-tab i {
    font-size: 1rem;
  }

  .demo-convention {
    display: none;
  }
}
</style>
