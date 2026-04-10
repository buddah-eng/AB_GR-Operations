<template>
  <div class="canvas-viewport">
    <VueFlow
      v-model:nodes="flowNodes"
      v-model:edges="flowEdges"
      :node-types="nodeTypes"
      :edge-types="edgeTypes"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
      :min-zoom="0.1"
      :max-zoom="4"
      :snap-to-grid="true"
      :snap-grid="[16, 16]"
      :nodes-draggable="canvasStore.mode === 'edit'"
      :nodes-connectable="canvasStore.mode === 'edit'"
      fit-view-on-init
      @node-click="handleNodeClick"
      @node-context-menu="handleNodeContextMenu"
      @pane-click="handlePaneClick"
    >
      <!-- Background pattern -->
      <Background :gap="20" :size="1" pattern-color="var(--surface-200)" />

      <!-- Minimap -->
      <MiniMap
        :node-color="getMinimapNodeColor"
        :pannable="true"
        :zoomable="true"
        class="viewport-minimap"
      />

      <!-- Zoom controls (built-in) -->
      <Controls :show-interactive="false" class="viewport-controls" />
    </VueFlow>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, markRaw } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import dagre from '@dagrejs/dagre'
import { MarkerType } from '@vue-flow/core'
import type {
  Node,
  Edge,
  NodeMouseEvent,
  NodeTypesObject,
  EdgeTypesObject,
} from '@vue-flow/core'

import { useCanvasStore } from '@/stores/canvas'
import type {
  VisualizationNode,
  VisualizationEdge,
} from '@/types/canvas'

import ConceptNode from './nodes/ConceptNode.vue'
import WorkflowNode from './nodes/WorkflowNode.vue'
import IntegrationNode from './nodes/IntegrationNode.vue'
import DepartmentRegion from './nodes/DepartmentRegion.vue'
import RelationshipEdge from './edges/RelationshipEdge.vue'
import DataFlowEdge from './edges/DataFlowEdge.vue'
import WorkflowEdge from './edges/WorkflowEdge.vue'

/* ---- Emits ---- */

const emit = defineEmits<{
  'node-click': [nodeId: string]
  'node-context-menu': [event: MouseEvent, nodeId: string]
  'pane-click': []
}>()

/* ---- Store ---- */

const canvasStore = useCanvasStore()

/* ---- Node & Edge type registration ---- */
/* Cast via unknown — Vue Flow injects NodeProps at runtime via slots */

const nodeTypes: NodeTypesObject = {
  concept: markRaw(ConceptNode) as unknown as NodeTypesObject[string],
  workflow: markRaw(WorkflowNode) as unknown as NodeTypesObject[string],
  integration: markRaw(IntegrationNode) as unknown as NodeTypesObject[string],
  department: markRaw(DepartmentRegion) as unknown as NodeTypesObject[string],
}

const edgeTypes: EdgeTypesObject = {
  relationship: markRaw(RelationshipEdge) as unknown as EdgeTypesObject[string],
  data_flow: markRaw(DataFlowEdge) as unknown as EdgeTypesObject[string],
  workflow: markRaw(WorkflowEdge) as unknown as EdgeTypesObject[string],
}

/* ---- Flow state ---- */

const flowNodes = ref<Node[]>([])
const flowEdges = ref<Edge[]>([])

/* ---- Department color palette ---- */

const DEPARTMENT_COLORS: Readonly<Record<string, string>> = {
  Anime: '#3b82f6',
  Gaming: '#10b981',
  Music: '#8b5cf6',
  Cosplay: '#ec4899',
  Panels: '#f59e0b',
  Artists: '#ef4444',
  Industry: '#6366f1',
  'To Be Determined': '#94a3b8',
}

function getDepartmentColor(region?: string): string {
  if (!region) return '#64748b'
  return DEPARTMENT_COLORS[region] ?? '#64748b'
}

/* ---- Auto-layout: dagre hierarchical with department clustering ---- */

const NODE_WIDTH = 200
const NODE_HEIGHT = 80

function computeDagreLayout(
  nodes: VisualizationNode[],
  edges: VisualizationEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'TB',
    nodesep: 120,
    ranksep: 160,
    edgesep: 40,
    marginx: 60,
    marginy: 60,
  })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  for (const edge of edges) {
    if (g.hasNode(edge.sourceNodeId) && g.hasNode(edge.targetNodeId)) {
      g.setEdge(edge.sourceNodeId, edge.targetNodeId)
    }
  }

  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const nodeId of g.nodes()) {
    const n = g.node(nodeId)
    if (n) {
      positions.set(nodeId, {
        x: n.x - NODE_WIDTH / 2,
        y: n.y - NODE_HEIGHT / 2,
      })
    }
  }
  return positions
}

/* ---- Cached layout positions ---- */

let cachedPositions: Map<string, { x: number; y: number }> = new Map()

/* ---- Transform visualization data to Vue Flow nodes/edges ---- */

function toFlowNode(vNode: VisualizationNode): Node {
  const pos = vNode.position ?? cachedPositions.get(vNode.id) ?? { x: 0, y: 0 }
  const departmentColor = getDepartmentColor(vNode.region)

  const dataMap: Record<string, unknown> = {
    concept: {
      label: vNode.label,
      icon: String(vNode.properties.icon ?? 'pi pi-circle'),
      propertyCount: Number(vNode.properties.propertyCount ?? 0),
      departmentColor,
      sourceId: vNode.sourceId,
      sourceTable: vNode.sourceTable,
      properties: vNode.properties,
    },
    workflow: {
      label: vNode.label,
      sourceId: vNode.sourceId,
      sourceTable: vNode.sourceTable,
      properties: vNode.properties,
    },
    integration: {
      label: vNode.label,
      sourceId: vNode.sourceId,
      sourceTable: vNode.sourceTable,
      properties: vNode.properties,
    },
    department: {
      label: vNode.label,
      color: departmentColor,
      nodeIds: [],
    },
  }

  return {
    id: vNode.id,
    type: vNode.type,
    position: pos,
    data: dataMap[vNode.type] ?? { label: vNode.label },
  }
}

function toFlowEdge(vEdge: VisualizationEdge): Edge {
  const dataMap: Record<string, unknown> = {
    relationship: {
      label: vEdge.label ?? '',
      cardinality: String(vEdge.properties.cardinality ?? ''),
      properties: vEdge.properties,
    },
    data_flow: {
      label: vEdge.label ?? '',
      hasPii: Boolean(vEdge.properties.hasPii),
      properties: vEdge.properties,
    },
    workflow: {
      label: vEdge.label ?? '',
      properties: vEdge.properties,
    },
  }

  return {
    id: vEdge.id,
    type: vEdge.type,
    source: vEdge.sourceNodeId,
    target: vEdge.targetNodeId,
    animated: vEdge.animated ?? vEdge.type === 'data_flow',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
    data: dataMap[vEdge.type] ?? { label: vEdge.label ?? '' },
  }
}

/* ---- Watch for graph data changes ---- */

watch(
  [() => canvasStore.filteredNodes, () => canvasStore.visibleEdges],
  ([nodes, edges]) => {
    // Recompute layout when nodes or edges change
    cachedPositions = computeDagreLayout(
      nodes as VisualizationNode[],
      edges as VisualizationEdge[],
    )
    flowNodes.value = (nodes as VisualizationNode[]).map(toFlowNode)
    flowEdges.value = (edges as VisualizationEdge[]).map(toFlowEdge)
  },
  { immediate: true },
)

/* ---- Event handlers ---- */

function handleNodeClick(event: NodeMouseEvent): void {
  canvasStore.selectNode(event.node.id)
  emit('node-click', event.node.id)
}

function handleNodeContextMenu(event: NodeMouseEvent): void {
  emit('node-context-menu', event.event as MouseEvent, event.node.id)
}

function handlePaneClick(): void {
  canvasStore.selectNode(null)
  emit('pane-click')
}

/* ---- Minimap helpers ---- */

function getMinimapNodeColor(node: Node): string {
  if (node.type === 'concept') {
    return (node.data as { departmentColor?: string }).departmentColor ?? '#64748b'
  }
  if (node.type === 'workflow') return '#a855f7'
  if (node.type === 'integration') return '#0ea5e9'
  if (node.type === 'department') return '#94a3b8'
  return '#64748b'
}
</script>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';
</style>

<style scoped>
.canvas-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--surface-50);
}

.canvas-viewport :deep(.vue-flow__pane) {
  cursor: grab;
}

.canvas-viewport :deep(.vue-flow__pane:active) {
  cursor: grabbing;
}

/* Minimap refinement */
.canvas-viewport :deep(.viewport-minimap) {
  bottom: var(--space-4);
  right: var(--space-4);
  border-radius: var(--radius-lg);
  border: var(--border-thin) solid var(--border-color);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

/* Controls refinement */
.canvas-viewport :deep(.viewport-controls) {
  bottom: var(--space-4);
  left: var(--space-4);
}

.canvas-viewport :deep(.vue-flow__controls-button) {
  background: var(--bg-card);
  border: var(--border-thin) solid var(--border-color);
  color: var(--text-secondary);
  transition: all var(--duration-fast) var(--ease-default);
}

.canvas-viewport :deep(.vue-flow__controls-button:hover) {
  background: var(--surface-50);
  color: var(--primary-600);
  transform: translateY(-1px);
}
</style>
