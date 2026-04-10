/* ------------------------------------------------------------------ */
/*  Canvas & Visualization Graph types                                 */
/* ------------------------------------------------------------------ */

import type { Node, Edge } from '@vue-flow/core'

// ---- Visualization data (API response shapes) ----

export type VisualizationNodeType =
  | 'concept'
  | 'workflow'
  | 'integration'
  | 'department'

export interface VisualizationNode {
  readonly id: string
  readonly type: VisualizationNodeType
  readonly label: string
  readonly sourceId: string
  readonly sourceTable: string
  readonly region?: string
  readonly properties: Record<string, unknown>
  readonly position?: { x: number; y: number }
}

export type VisualizationEdgeType =
  | 'relationship'
  | 'data_flow'
  | 'workflow'

export interface VisualizationEdge {
  readonly id: string
  readonly type: VisualizationEdgeType
  readonly sourceNodeId: string
  readonly targetNodeId: string
  readonly label?: string
  readonly properties: Record<string, unknown>
  readonly animated?: boolean
}

export interface VisualizationRegion {
  readonly id: string
  readonly label: string
  readonly color: string
  readonly nodeIds: readonly string[]
}

export interface VisualizationGraphMetadata {
  readonly generatedAt: string
  readonly nodeCount: number
  readonly edgeCount: number
  readonly version?: string
}

export interface VisualizationGraph {
  readonly nodes: readonly VisualizationNode[]
  readonly edges: readonly VisualizationEdge[]
  readonly regions: readonly VisualizationRegion[]
  readonly metadata: VisualizationGraphMetadata
}

// ---- Canvas UI state ----

export type CanvasMode = 'view' | 'edit'

export type CanvasLayoutAlgorithm =
  | 'force-directed'
  | 'hierarchical'
  | 'radial'
  | 'grid'

export type ZoomLevel = 'system' | 'department' | 'concept'

export type OverlayType = 'data_flows' | 'workflows'

export interface CanvasState {
  readonly mode: CanvasMode
  readonly layout: CanvasLayoutAlgorithm
  readonly zoomLevel: ZoomLevel
  readonly activeOverlays: readonly OverlayType[]
  readonly selectedNodeId: string | null
  readonly searchQuery: string
  readonly isFullscreen: boolean
}

// ---- Vue Flow node/edge data payloads ----

export interface ConceptNodeData {
  readonly label: string
  readonly icon: string
  readonly propertyCount: number
  readonly departmentColor: string
  readonly sourceId: string
  readonly sourceTable: string
  readonly properties: Record<string, unknown>
}

export interface WorkflowNodeData {
  readonly label: string
  readonly sourceId: string
  readonly sourceTable: string
  readonly properties: Record<string, unknown>
}

export interface IntegrationNodeData {
  readonly label: string
  readonly sourceId: string
  readonly sourceTable: string
  readonly properties: Record<string, unknown>
}

export interface DepartmentRegionData {
  readonly label: string
  readonly color: string
  readonly nodeIds: readonly string[]
}

export interface RelationshipEdgeData {
  readonly label: string
  readonly cardinality?: string
  readonly properties: Record<string, unknown>
}

export interface DataFlowEdgeData {
  readonly label: string
  readonly hasPii: boolean
  readonly properties: Record<string, unknown>
}

export interface WorkflowEdgeData {
  readonly label: string
  readonly properties: Record<string, unknown>
}

// ---- Vue Flow typed aliases ----

export type ConceptFlowNode = Node<ConceptNodeData>
export type WorkflowFlowNode = Node<WorkflowNodeData>
export type IntegrationFlowNode = Node<IntegrationNodeData>
export type DepartmentFlowNode = Node<DepartmentRegionData>
export type CanvasFlowNode =
  | ConceptFlowNode
  | WorkflowFlowNode
  | IntegrationFlowNode
  | DepartmentFlowNode

export type RelationshipFlowEdge = Edge<RelationshipEdgeData>
export type DataFlowFlowEdge = Edge<DataFlowEdgeData>
export type WorkflowFlowEdge = Edge<WorkflowEdgeData>
export type CanvasFlowEdge =
  | RelationshipFlowEdge
  | DataFlowFlowEdge
  | WorkflowFlowEdge

// ---- Context menu ----

export interface ContextMenuAction {
  readonly label: string
  readonly icon: string
  readonly action: string
}

export interface ContextMenuState {
  readonly visible: boolean
  readonly x: number
  readonly y: number
  readonly nodeId: string | null
  readonly actions: readonly ContextMenuAction[]
}
