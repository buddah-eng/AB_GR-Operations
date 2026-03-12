import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type {
  OntologyData,
  OntologyConcept,
  OntologyProperty,
  OntologyRelationship,
} from '@/types'

export const useOntologyStore = defineStore('ontology', () => {
  /* ---- state ---- */
  const concepts = ref<OntologyConcept[]>([])
  const version = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  /* ---- getters ---- */

  const getConceptByKey = computed(() => {
    const map = new Map<string, OntologyConcept>()
    for (const c of concepts.value) {
      map.set(c.key, c)
    }
    return (key: string): OntologyConcept | undefined => map.get(key)
  })

  const getPropertiesForConcept = computed(() => {
    return (conceptKey: string): OntologyProperty[] => {
      const concept = getConceptByKey.value(conceptKey)
      return concept?.properties ?? []
    }
  })

  const getRelationshipsForConcept = computed(() => {
    return (conceptKey: string): OntologyRelationship[] => {
      const concept = getConceptByKey.value(conceptKey)
      return concept?.relationships ?? []
    }
  })

  /* ---- actions ---- */

  async function loadOntology(): Promise<void> {
    if (loading.value) return

    loading.value = true
    error.value = null

    try {
      const data = await api.get<OntologyData>('/api/ontology')
      concepts.value = data.concepts
      version.value = data.version
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load ontology'
      error.value = message

      // Fall back to default concepts if API unavailable
      if (concepts.value.length === 0) {
        concepts.value = getDefaultConcepts()
      }
    } finally {
      loading.value = false
    }
  }

  return {
    // state
    concepts,
    version,
    loading,
    error,
    // getters
    getConceptByKey,
    getPropertiesForConcept,
    getRelationshipsForConcept,
    // actions
    loadOntology,
  }
})

/* ------------------------------------------------------------------ */
/*  Default concepts (used when backend is unavailable)                */
/* ------------------------------------------------------------------ */

function getDefaultConcepts(): OntologyConcept[] {
  return [
    {
      key: 'guest',
      label: 'Guest',
      pluralLabel: 'Guests',
      icon: 'pi pi-users',
      properties: [],
      relationships: [],
    },
    {
      key: 'staff',
      label: 'Staff',
      pluralLabel: 'Staff',
      icon: 'pi pi-id-card',
      properties: [],
      relationships: [],
    },
    {
      key: 'schedule',
      label: 'Event',
      pluralLabel: 'Schedule',
      icon: 'pi pi-calendar',
      properties: [],
      relationships: [],
    },
    {
      key: 'prep',
      label: 'Prep Item',
      pluralLabel: 'Prep Tracker',
      icon: 'pi pi-check-square',
      properties: [],
      relationships: [],
    },
  ]
}
