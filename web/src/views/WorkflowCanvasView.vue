<template>
  <div class="space-y-4">
    <!-- Header row -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <i class="pi pi-sitemap text-xl text-primary-500" />
        <h1 class="font-display text-2xl font-bold tracking-tight text-surface-900">
          {{ workflowName || 'Workflow Canvas' }}
        </h1>
        <Tag
          v-if="workflowEnabled === false"
          value="Disabled"
          severity="warning"
          rounded
        />
      </div>
      <div class="flex items-center gap-2">
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
    <div
      v-if="errorMessage"
      class="rounded-lg border-l-4 border-red-400 bg-red-50 px-5 py-4"
    >
      <div class="flex items-center gap-2">
        <i class="pi pi-exclamation-circle text-red-500" />
        <span class="text-sm font-medium text-red-700">{{ errorMessage }}</span>
      </div>
      <button
        class="mt-2 text-xs text-red-600 underline hover:text-red-800"
        @click="loadWorkflow"
      >
        Try again
      </button>
    </div>

    <!-- Loading state -->
    <div
      v-if="loading && flowNodes.length === 0"
      class="flex flex-col items-center justify-center py-20"
    >
      <ProgressSpinner
        style="width: 40px; height: 40px"
        stroke-width="4"
        aria-label="Loading workflow"
      />
      <span class="mt-3 text-sm text-surface-500">Loading workflow...</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="flowNodes.length === 0 && !loading && !errorMessage"
      class="flex flex-col items-center justify-center py-20"
    >
      <i class="pi pi-sitemap text-4xl text-surface-300 mb-3" />
      <h2 class="text-lg font-semibold text-surface-600">No Workflow Data</h2>
      <p class="text-sm text-surface-400 mt-1 max-w-md text-center">
        This workflow has no configuration yet. Use the workflow builder to define
        triggers, conditions, and actions.
      </p>
      <Button
        label="Open Builder"
        icon="pi pi-external-link"
        severity="secondary"
        size="small"
        class="mt-4"
        @click="navigateToBuilder"
      />
    </div>

    <!-- Canvas -->
    <div
      v-else
      :class="[
        'rounded-xl border border-surface-200 overflow-hidden bg-surface-50',
        'h-[calc(100vh-200px)]',
      ]"
    >
      <VueFlow
        :nodes="flowNodes"
        :edges="flowEdges"
        :node-types="nodeTypes"
        :default-viewport="{ zoom: 0.9, x: 50, y: 100 }"
        fit-view-on-init
        class="w-full h-full"
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
      class="w-96"
    >
      <div v-if="selectedNodeData" class="space-y-4">
        <div>
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-1">
            Type
          </div>
          <Tag :value="selectedNodeData.nodeType" rounded />
        </div>

        <div v-if="selectedNodeData.details">
          <div class="text-xs font-medium uppercase tracking-widest text-surface-500 mb-2">
            Details
          </div>
          <div class="space-y-2">
            <div
              v-for="(value, key) in selectedNodeData.details"
              :key="String(key)"
              class="flex justify-between items-start gap-2 py-1.5 border-b border-surface-50 last:border-0"
            >
              <span class="text-xs font-medium text-surface-500">{{ formatKey(String(key)) }}</span>
              <span class="text-xs text-surface-800 text-right">{{ String(value) }}</span>
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
