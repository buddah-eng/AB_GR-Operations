import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api/client'
import type {
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
      const raw = await api.get<Record<string, unknown>>('/api/ontology')

      // The API returns concepts as an object or array, properties/relationships as separate maps.
      // Merge them into the frontend's OntologyConcept[] shape.
      const rawConcepts = raw.concepts as Record<string, unknown> | OntologyConcept[]
      const rawProperties = (raw.properties ?? {}) as Record<string, OntologyProperty[]>
      const rawRelationships = (raw.relationships ?? {}) as Record<string, OntologyRelationship[]>

      // Handle both array (from Vercel shim) and object (from real backend) formats
      const conceptEntries: Array<[string, Record<string, unknown>]> = Array.isArray(rawConcepts)
        ? rawConcepts.map((c: OntologyConcept) => [c.key, c as unknown as Record<string, unknown>])
        : Object.entries(rawConcepts as Record<string, Record<string, unknown>>)

      concepts.value = conceptEntries.map(([key, c]) => ({
        key,
        label: (c.label ?? c.name ?? key) as string,
        pluralLabel: (c.pluralLabel ?? c.pluralName ?? c.plural_name ?? `${c.label ?? c.name ?? key}s`) as string,
        icon: (c.icon ?? 'pi pi-box') as string,
        properties: (c.properties as OntologyProperty[]) ?? rawProperties[key] ?? [],
        relationships: ((c.relationships as unknown[] | undefined) ?? (rawRelationships[key] as unknown[]) ?? []).map(
          (r) => {
            const rel = r as Record<string, unknown>
            return {
              key: rel.key as string,
              label: rel.label as string,
              targetConcept: (rel.targetConcept ?? rel.target ?? rel.target_concept_key) as string,
              cardinality: (rel.cardinality ?? 'has-many') as OntologyRelationship['cardinality'],
            }
          }
        ),
      }))

      version.value = (raw.version ?? raw.loadedAt ?? '') as string
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
