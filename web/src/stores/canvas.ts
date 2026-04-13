import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type {
  VisualizationGraph,
  CanvasMode,
  CanvasLayoutAlgorithm,
  ZoomLevel,
  OverlayType,
} from '@/types/canvas'

/* ------------------------------------------------------------------ */
/*  Default empty graph (shown before data loads)                      */
/* ------------------------------------------------------------------ */

function createEmptyGraph(): VisualizationGraph {
  return {
    nodes: [],
    edges: [],
    regions: [],
    metadata: {
      generatedAt: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0,
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Canvas store                                                       */
/* ------------------------------------------------------------------ */

export const useCanvasStore = defineStore('canvas', () => {
  /* ---- state ---- */
  const graph = ref<VisualizationGraph>(createEmptyGraph())
  const loading = ref(false)
  const error = ref<string | null>(null)

  const mode = ref<CanvasMode>('view')
  const layout = ref<CanvasLayoutAlgorithm>('force-directed')
  const zoomLevel = ref<ZoomLevel>('system')
  const activeOverlays = ref<OverlayType[]>([])
  const selectedNodeId = ref<string | null>(null)
  const searchQuery = ref('')
  const isFullscreen = ref(false)

  /* ---- getters ---- */

  const hasData = computed(() => graph.value.nodes.length > 0)

  const selectedNode = computed(() => {
    if (selectedNodeId.value === null) return null
    return graph.value.nodes.find((n) => n.id === selectedNodeId.value) ?? null
  })

  const filteredNodes = computed(() => {
    const query = searchQuery.value.toLowerCase().trim()
    if (!query) return graph.value.nodes
    return graph.value.nodes.filter((n) =>
      n.label.toLowerCase().includes(query),
    )
  })

  const isOverlayActive = computed(() => {
    return (overlay: OverlayType): boolean =>
      activeOverlays.value.includes(overlay)
  })

  const visibleEdges = computed(() => {
    return graph.value.edges.filter((edge) => {
      if (edge.type === 'data_flow' && !activeOverlays.value.includes('data_flows')) {
        return false
      }
      if (edge.type === 'workflow' && !activeOverlays.value.includes('workflows')) {
        return false
      }
      return true
    })
  })

  /* ---- actions ---- */

  async function loadGraph(): Promise<void> {
    if (loading.value) return

    loading.value = true
    error.value = null

    try {
      const data = await api.get<VisualizationGraph>(
        '/api/ontology/visualization/graph',
      )
      graph.value = data
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load visualization data'
      error.value = message

      if (graph.value.nodes.length === 0) {
        graph.value = createEmptyGraph()
      }
    } finally {
      loading.value = false
    }
  }

  function setMode(newMode: CanvasMode): void {
    mode.value = newMode
  }

  function setLayout(newLayout: CanvasLayoutAlgorithm): void {
    layout.value = newLayout
  }

  function setZoomLevel(newLevel: ZoomLevel): void {
    zoomLevel.value = newLevel
  }

  function toggleOverlay(overlay: OverlayType): void {
    const index = activeOverlays.value.indexOf(overlay)
    if (index >= 0) {
      activeOverlays.value = activeOverlays.value.filter(
        (o) => o !== overlay,
      )
    } else {
      activeOverlays.value = [...activeOverlays.value, overlay]
    }
  }

  function selectNode(nodeId: string | null): void {
    selectedNodeId.value = nodeId
  }

  function setSearchQuery(query: string): void {
    searchQuery.value = query
  }

  function setFullscreen(value: boolean): void {
    isFullscreen.value = value
  }

  function reset(): void {
    mode.value = 'view'
    layout.value = 'force-directed'
    zoomLevel.value = 'system'
    activeOverlays.value = []
    selectedNodeId.value = null
    searchQuery.value = ''
    isFullscreen.value = false
  }

  return {
    // state
    graph,
    loading,
    error,
    mode,
    layout,
    zoomLevel,
    activeOverlays,
    selectedNodeId,
    searchQuery,
    isFullscreen,
    // getters
    hasData,
    selectedNode,
    filteredNodes,
    isOverlayActive,
    visibleEdges,
    // actions
    loadGraph,
    setMode,
    setLayout,
    setZoomLevel,
    toggleOverlay,
    selectNode,
    setSearchQuery,
    setFullscreen,
    reset,
  }
})
