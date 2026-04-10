/**
 * Composable for loading a named FormConfig from the API.
 * Transforms backend shape to frontend FormConfig format.
 */

import { ref, watch, type Ref } from 'vue'
import { api } from '@/api/client'
import type { FormConfig, FormFieldConfig, FormStep } from '@/types/forms'

interface UseFormConfigReturn {
  config: Ref<FormConfig | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
}

/**
 * Adapt backend FormConfig to frontend shape.
 * Backend uses: name, layout='single', fields[].propertyKey
 * Frontend uses: title, layout='single-column', fields[].key
 */
function adaptFormConfig(raw: Record<string, unknown>): FormConfig {
  const layout = adaptLayout((raw.layout as string) ?? 'single')
  const fields = adaptFormFields(raw.fields as Record<string, unknown>[] | undefined)
  const steps = adaptFormSteps(raw.steps as Record<string, unknown>[] | undefined)

  return {
    id: (raw.id as string) ?? '',
    title: (raw.title as string) ?? (raw.name as string) ?? '',
    layout,
    conceptKey: (raw.conceptKey ?? raw.concept_key) as string | undefined,
    fields,
    steps,
    showCancel: raw.showCancel as boolean | undefined,
    submitLabel: raw.submitLabel as string | undefined,
    cancelLabel: raw.cancelLabel as string | undefined,
  }
}

function adaptLayout(layout: string): FormConfig['layout'] {
  if (layout === 'single') return 'single-column'
  if (layout === 'two-column' || layout === 'wizard') return layout
  return 'single-column'
}

function adaptFormFields(
  raw: Record<string, unknown>[] | undefined
): FormFieldConfig[] | undefined {
  if (!raw) return undefined
  return raw.map((f) => ({
    key: (f.key ?? f.propertyKey ?? f.property_key) as string,
    label: f.label as string | undefined,
    placeholder: (f.placeholder ?? f.overridePlaceholder ?? f.override_placeholder) as string | undefined,
    required: f.required as boolean | undefined,
    readOnly: f.readOnly as boolean | undefined,
    hidden: f.hidden as boolean | undefined,
    helpText: f.helpText as string | undefined,
    defaultValue: f.defaultValue ?? f.default_value,
    colSpan: f.colSpan as 1 | 2 | undefined,
    showIf: f.showIf as FormFieldConfig['showIf'],
  }))
}

function adaptFormSteps(
  raw: Record<string, unknown>[] | undefined
): FormStep[] | undefined {
  if (!raw) return undefined
  return raw.map((s) => ({
    key: (s.key ?? s.name) as string,
    label: s.label as string,
    description: s.description as string | undefined,
    icon: s.icon as string | undefined,
    fields: adaptFormFields(s.fields as Record<string, unknown>[] | undefined) ?? [],
  }))
}

export function useFormConfig(
  conceptKey: Ref<string> | string,
  formName: Ref<string> | string
): UseFormConfigReturn {
  const config = ref<FormConfig | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    const concept = typeof conceptKey === 'string' ? conceptKey : conceptKey.value
    const name = typeof formName === 'string' ? formName : formName.value
    if (!concept || !name) return

    loading.value = true
    error.value = null

    try {
      const raw = await api.get<Record<string, unknown>>(
        `/api/ontology/configs/forms/${encodeURIComponent(concept)}/${encodeURIComponent(name)}`
      )
      config.value = adaptFormConfig(raw)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load form config'
      config.value = null
    } finally {
      loading.value = false
    }
  }

  reload()

  if (typeof conceptKey !== 'string') {
    watch(conceptKey, reload)
  }
  if (typeof formName !== 'string') {
    watch(formName, reload)
  }

  return { config, loading, error, reload }
}
