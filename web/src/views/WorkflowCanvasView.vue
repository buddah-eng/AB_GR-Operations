<template>
  <div class="view-page">
    <!-- Header row -->
    <div class="view-header">
      <div class="view-header__left">
        <i class="pi pi-sitemap view-header__icon" />
        <h1 class="page-title">{{ workflowName || 'Workflow Canvas' }}</h1>
        <Tag
          v-if="workflowEnabled === false"
          value="Disabled"
          severity="warning"
          rounded
        />
      </div>
      <div class="view-header__right">
        <Button
          label="Dry Run"
          icon="pi pi-play"
          severity="secondary"
          outlined
          size="small"
          :loading="dryRunning"
          @click="handleDryRun"
        />
        <ToggleButton
          v-model="showRelated"
          on-label="Related"
          off-label="Related"
          on-icon="pi pi-link"
          off-icon="pi pi-link"
          size="small"
          aria-label="Show related workflows"
        />
        <Button
          label="Open in Builder"
          icon="pi pi-external-link"
          severity="secondary"
          text
          size="small"
          @click="navigateToBuilder"
        />
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          severity="secondary"
          size="small"
          :loading="loading"
          @click="loadWorkflow"
        />
      </div>
    </div>

    <!-- Error state -->
    <div v-if="errorMessage" class="view-error">
      <div class="view-error__content">
        <i class="pi pi-exclamation-circle view-error__icon" />
        <span class="view-error__text">{{ errorMessage }}</span>
      </div>
      <button class="view-error__retry" @click="loadWorkflow">
        Try again
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading && flowNodes.length === 0" class="view-loading">
      <ProgressSpinner
        style="width: 40px; height: 40px"
        stroke-width="4"
        aria-label="Loading workflow"
      />
      <span class="view-loading__text">Loading workflow...</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="flowNodes.length === 0 && !loading && !errorMessage"
      class="empty-state"
    >
      <div class="icon">
        <i class="pi pi-sitemap" />
      </div>
      <h2>No Workflow Data</h2>
      <p>
        This workflow has no configuration yet. Use the workflow builder to define
        triggers, conditions, and actions.
      </p>
      <Button
        label="Open Builder"
        icon="pi pi-external-link"
        severity="secondary"
        size="small"
        style="margin-top: var(--space-4)"
        @click="navigateToBuilder"
      />
    </div>

    <!-- Canvas -->
    <div v-else class="view-canvas-container">
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.9, x: 50, y: 100 }"
        fit-view-on-init
        class="view-canvas-flow"
        @node-click="handleNodeClick"
      >
        <Background />
        <Controls />
        <MiniMap />
      </VueFlow>
    </div>

    <!-- Config panel (slide-in) -->
    <Sidebar
      v-model:visible="configPanelVisible"
      position="right"
      :header="configPanelTitle"
      class="view-sidebar-panel"
    >
      <div v-if="selectedNodeData" class="view-detail-list">
        <div class="view-detail-item">
          <div class="view-detail-item__label">Type</div>
          <Tag :value="selectedNodeData.nodeType" rounded />
        </div>

        <div v-if="selectedNodeData.details" class="view-detail-item">
          <div class="view-detail-item__label">Details</div>
          <div class="view-properties-grid">
            <div
              v-for="(value, key) in selectedNodeData.details"
              :key="String(key)"
              class="view-property-row"
            >
              <span class="view-property-row__key">{{ formatKey(String(key)) }}</span>
              <span class="view-property-row__value">{{ String(value) }}</span>
            </div>
          </div>
        </div>
      </div>
    </Sidebar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, markRaw, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import type { Node, Edge } from '@vue-flow/core'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import Sidebar from 'primevue/sidebar'
import ToggleButton from 'primevue/togglebutton'
import ProgressSpinner from 'primevue/progressspinner'

import { api } from '@/api/client'
import type { WorkflowConfig } from '@/types/workflow'
import TriggerNode from '@/components/canvas/workflow-nodes/TriggerNode.vue'
import ConditionDiamondNode from '@/components/canvas/workflow-nodes/ConditionDiamondNode.vue'
import ActionNodeComponent from '@/components/canvas/workflow-nodes/ActionNode.vue'
import EndNode from '@/components/canvas/workflow-nodes/EndNode.vue'

/* ---- Route ---- */

const route = useRoute()
const router = useRouter()

const workflowId = computed(() => String(route.params.id ?? ''))

/* ---- State ---- */

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const dryRunning = ref(false)
const showRelated = ref(false)
const configPanelVisible = ref(false)

const workflowName = ref('')
const workflowEnabled = ref(true)

const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])

/* ---- Node types registration ---- */

const nodeTypes = {
  trigger: markRaw(TriggerNode as Component),
  conditionDiamond: markRaw(ConditionDiamondNode as Component),
  action: markRaw(ActionNodeComponent as Component),
  end: markRaw(EndNode as Component),
}

/* ---- Selected node ---- */

interface SelectedNodeInfo {
  nodeType: string
  details: Record<string, unknown>
}

const selectedNodeData = ref<SelectedNodeInfo | null>(null)

const configPanelTitle = computed(
  () => selectedNodeData.value?.nodeType ?? 'Node Details',
)

/* ---- Build flow from WorkflowConfig ---- */

function buildFlow(config: WorkflowConfig): void {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const xSpacing = 280
  let x = 0
  const y = 150

  // 1. Trigger node
  const triggerId = 'trigger'
  nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x, y },
    data: {
      label: config.trigger.eventName ?? config.trigger.buttonLabel ?? config.trigger.type,
      triggerType: config.trigger.type,
      eventName: config.trigger.eventName ?? null,
      fieldName: config.trigger.fieldName ?? null,
      schedule: config.trigger.schedule ?? null,
    },
  })

  let lastNodeId = triggerId
  x += xSpacing

  // 2. Condition node (if present)
  if (config.condition) {
    const condId = 'condition'
    nodes.push({
      id: condId,
      type: 'conditionDiamond',
      position: { x, y: y - 10 },
      data: {
        summary: summarizeCondition(config.condition),
      },
    })

    edges.push({
      id: `${lastNodeId}-${condId}`,
      source: lastNodeId,
      target: condId,
      type: 'default',
      animated: false,
    })

    // False branch -> end (skipped)
    const skippedEndId = 'end-skipped'
    nodes.push({
      id: skippedEndId,
      type: 'end',
      position: { x, y: y + 180 },
      data: { type: 'skipped' },
    })

    edges.push({
      id: `${condId}-${skippedEndId}`,
      source: condId,
      sourceHandle: 'false',
      target: skippedEndId,
      type: 'default',
      label: 'No',
      style: { stroke: '#f87171', strokeDasharray: '6 4' },
      animated: false,
    })

    lastNodeId = condId
    x += xSpacing
  }

  // 3. Action nodes
  for (const [idx, action] of config.actions.entries()) {
    const actionId = `action-${idx}`
    nodes.push({
      id: actionId,
      type: 'action',
      position: { x, y },
      data: {
        label: action.label,
        actionType: action.type,
        position: idx,
        lastResult: null,
      },
    })

    const sourceHandle = lastNodeId === 'condition' ? 'true' : undefined
    edges.push({
      id: `${lastNodeId}-${actionId}`,
      source: lastNodeId,
      sourceHandle,
      target: actionId,
      type: 'default',
      label: lastNodeId === 'condition' ? 'Yes' : undefined,
      style: lastNodeId === 'condition' ? { stroke: '#22c55e' } : undefined,
      animated: false,
    })

    lastNodeId = actionId
    x += xSpacing
  }

  // 4. End node
  const endId = 'end-success'
  nodes.push({
    id: endId,
    type: 'end',
    position: { x, y },
    data: { type: 'success' },
  })

  edges.push({
    id: `${lastNodeId}-${endId}`,
    source: lastNodeId,
    target: endId,
    type: 'default',
    animated: false,
  })

  flowNodes.value = nodes
  flowEdges.value = edges
}

function summarizeCondition(condition: unknown): string {
  if (!condition || typeof condition !== 'object') return 'Condition'
  const cond = condition as Record<string, unknown>
  if (cond['field'] && cond['operator'] && cond['value'] !== undefined) {
    return `${String(cond['field'])} ${String(cond['operator'])} ${String(cond['value'])}`
  }
  if (cond['type'] === 'and') return 'All conditions'
  if (cond['type'] === 'or') return 'Any condition'
  return 'Condition'
}

/* ---- Load workflow ---- */

async function loadWorkflow(): Promise<void> {
  if (!workflowId.value) return

  loading.value = true
  errorMessage.value = null

  try {
    const config = await api.get<WorkflowConfig>(
      `/api/workflow-configs/${workflowId.value}`,
    )
    workflowName.value = config.name
    workflowEnabled.value = config.enabled
    buildFlow(config)
  } catch (err) {
    errorMessage.value =
      err instanceof Error ? err.message : 'Failed to load workflow'
  } finally {
    loading.value = false
  }
}

/* ---- Dry run ---- */

async function handleDryRun(): Promise<void> {
  if (!workflowId.value) return

  dryRunning.value = true
  try {
    const result = await api.post<{
      executionPath: string[]
      conditionResult: boolean | null
    }>(`/api/workflow-configs/${workflowId.value}/dry-run`, {})

    // Highlight active path
    const activePath = new Set(result.executionPath)
    flowNodes.value = flowNodes.value.map((n) => ({
      ...n,
      style: activePath.has(n.id)
        ? { border: '2px solid #22c55e', boxShadow: '0 0 8px rgba(34,197,94,0.3)' }
        : { opacity: 0.4 },
    }))

    flowEdges.value = flowEdges.value.map((e) => ({
      ...e,
      animated: activePath.has(e.source) && activePath.has(e.target),
      style: activePath.has(e.source) && activePath.has(e.target)
        ? { stroke: '#22c55e', strokeWidth: 3 }
        : { stroke: '#d1d5db', strokeWidth: 1 },
    }))
  } catch (err) {
    errorMessage.value =
      err instanceof Error ? err.message : 'Dry run failed'
  } finally {
    dryRunning.value = false
  }
}

/* ---- Node click ---- */

function handleNodeClick(event: { node: Node }): void {
  const nodeData = event.node.data as Record<string, unknown>
  selectedNodeData.value = {
    nodeType: String(event.node.type ?? 'unknown'),
    details: { ...nodeData },
  }
  configPanelVisible.value = true
}

/* ---- Navigation ---- */

function navigateToBuilder(): void {
  router.push(`/builder/workflow/${workflowId.value || ''}`)
}

/* ---- Helpers ---- */

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim()
}

/* ---- Lifecycle ---- */

onMounted(() => {
  loadWorkflow()
})
</script>

<style scoped>
.view-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-header__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.view-header__icon {
  font-size: var(--text-xl);
  color: var(--primary-500);
}

.view-header__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.view-error {
  border-radius: var(--radius-lg);
  border-left: 4px solid var(--color-error);
  background: #fef2f2;
  padding: var(--space-4) var(--space-5);
}

.view-error__content {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.view-error__icon {
  color: var(--color-error);
}

.view-error__text {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: #b91c1c;
}

.view-error__retry {
  margin-top: var(--space-2);
  font-size: var(--text-xs);
  color: #dc2626;
  text-decoration: underline;
  background: none;
  border: none;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-default);
}

.view-error__retry:hover {
  color: #991b1b;
}

.view-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-20) 0;
}

.view-loading__text {
  margin-top: var(--space-3);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.view-canvas-container {
  border-radius: var(--radius-xl);
  border: var(--border-thin) solid var(--border-color);
  overflow: hidden;
  background: var(--surface-50);
  height: calc(100vh - 200px);
}

.view-canvas-flow {
  width: 100%;
  height: 100%;
}

.view-sidebar-panel {
  width: 24rem;
}

.view-detail-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.view-detail-item__label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--text-muted);
  margin-bottom: var(--space-1);
}

.view-properties-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.view-property-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-2);
  padding: 6px 0;
  border-bottom: var(--border-thin) solid var(--surface-100);
}

.view-property-row:last-child {
  border-bottom: none;
}

.view-property-row__key {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  flex-shrink: 0;
}

.view-property-row__value {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--text-primary);
  text-align: right;
}
</style>
