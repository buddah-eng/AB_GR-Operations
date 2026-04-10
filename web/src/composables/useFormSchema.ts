/* ------------------------------------------------------------------ */
/*  FormKit schema bridge composable                                   */
/*  Converts FormConfig + OntologyProperty[] into FormKit schema nodes */
/* ------------------------------------------------------------------ */

import { computed, type Ref } from 'vue'
import type { OntologyProperty } from '@/types'
import type {
  FormConfig,
  FormFieldConfig,
  ConditionExpression,
} from '@/types/forms'
import { PROPERTY_TYPE_INPUT_MAP } from '@/types/forms'

/** A FormKit schema node (simplified) */
export interface FormKitSchemaField {
  $formkit: string
  name: string
  label: string
  placeholder?: string
  help?: string
  validation?: string
  options?: Array<{ value: string; label: string }>
  disabled?: boolean
  step?: string
  min?: string
  attrs?: Record<string, unknown>
}

/**
 * Resolves the FormKit input type from an ontology property type string.
 */
function resolveInputType(propertyType: string): string {
  return PROPERTY_TYPE_INPUT_MAP[propertyType] ?? 'text'
}

/**
 * Builds a FormKit validation string from a field config and property.
 */
function buildValidation(
  field: FormFieldConfig,
  property: OntologyProperty | undefined,
): string {
  const rules: string[] = []

  if (field.required || property?.required) {
    rules.push('required')
  }

  const propType = property?.type ?? ''
  if (propType === 'email') {
    rules.push('email')
  }
  if (propType === 'url') {
    rules.push('url')
  }
  if (propType === 'number' || propType === 'integer' || propType === 'decimal' || propType === 'currency' || propType === 'percentage') {
    rules.push('number')
  }

  return rules.join('|')
}

/**
 * Converts a single FormFieldConfig + OntologyProperty into a FormKit schema node.
 */
function fieldToSchemaNode(
  field: FormFieldConfig,
  property: OntologyProperty | undefined,
): FormKitSchemaField {
  const propType = property?.type ?? 'text'
  const inputType = resolveInputType(propType)

  const node: FormKitSchemaField = {
    $formkit: inputType,
    name: field.key,
    label: field.label ?? property?.label ?? field.key,
    placeholder: field.placeholder ?? property?.placeholder,
    help: field.helpText ?? property?.description,
  }

  const validation = buildValidation(field, property)
  if (validation) {
    node.validation = validation
  }

  if (field.readOnly || property?.readOnly) {
    node.disabled = true
  }

  // Map options for select/radio/multi-select
  if (property?.options && property.options.length > 0) {
    node.options = property.options.map((opt) => ({
      value: opt.value,
      label: opt.label,
    }))
  }

  // Number-specific attributes
  if (propType === 'integer') {
    node.step = '1'
  }
  if (propType === 'decimal' || propType === 'currency') {
    node.step = '0.01'
  }
  if (propType === 'percentage') {
    node.step = '1'
    node.min = '0'
  }

  return node
}

/**
 * Evaluates a ConditionExpression against form values.
 */
export function evaluateCondition(
  condition: ConditionExpression,
  values: Record<string, unknown>,
): boolean {
  switch (condition.type) {
    case 'comparison':
      return evaluateComparison(condition, values)
    case 'and':
      return (condition.children ?? []).every((child) =>
        evaluateCondition(child, values),
      )
    case 'or':
      return (condition.children ?? []).some((child) =>
        evaluateCondition(child, values),
      )
    case 'not':
      return condition.child
        ? !evaluateCondition(condition.child, values)
        : true
    default:
      return true
  }
}

function evaluateComparison(
  condition: ConditionExpression,
  values: Record<string, unknown>,
): boolean {
  if (!condition.field || !condition.operator) return true

  const fieldValue = values[condition.field]
  const target = condition.value

  switch (condition.operator) {
    case 'equals':
      return fieldValue === target
    case 'not_equals':
      return fieldValue !== target
    case 'contains':
      return typeof fieldValue === 'string' && typeof target === 'string'
        ? fieldValue.includes(target)
        : false
    case 'not_contains':
      return typeof fieldValue === 'string' && typeof target === 'string'
        ? !fieldValue.includes(target)
        : true
    case 'starts_with':
      return typeof fieldValue === 'string' && typeof target === 'string'
        ? fieldValue.startsWith(target)
        : false
    case 'ends_with':
      return typeof fieldValue === 'string' && typeof target === 'string'
        ? fieldValue.endsWith(target)
        : false
    case 'greater_than':
      return Number(fieldValue) > Number(target)
    case 'less_than':
      return Number(fieldValue) < Number(target)
    case 'greater_or_equal':
      return Number(fieldValue) >= Number(target)
    case 'less_or_equal':
      return Number(fieldValue) <= Number(target)
    case 'is_empty':
      return fieldValue === null || fieldValue === undefined || fieldValue === ''
    case 'is_not_empty':
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== ''
    case 'in':
      return Array.isArray(target) ? target.includes(fieldValue) : false
    case 'not_in':
      return Array.isArray(target) ? !target.includes(fieldValue) : true
    case 'between': {
      if (!Array.isArray(target) || target.length < 2) return false
      const num = Number(fieldValue)
      return num >= Number(target[0]) && num <= Number(target[1])
    }
    default:
      return true
  }
}

/**
 * Composable that converts a FormConfig into FormKit schema nodes.
 * Resolves ontology properties and applies conditional visibility.
 */
export function useFormSchema(
  config: Ref<FormConfig>,
  properties: Ref<OntologyProperty[]>,
  formValues: Ref<Record<string, unknown>>,
) {
  const propertyMap = computed(() => {
    const map = new Map<string, OntologyProperty>()
    for (const prop of properties.value) {
      map.set(prop.key, prop)
    }
    return map
  })

  /**
   * Convert a list of FormFieldConfig into FormKit schema nodes,
   * filtering out conditionally hidden fields.
   */
  function convertFields(fields: FormFieldConfig[]): FormKitSchemaField[] {
    return fields
      .filter((field) => {
        if (field.hidden) return false
        if (field.showIf) {
          return evaluateCondition(field.showIf, formValues.value)
        }
        return true
      })
      .map((field) => {
        const property = field.property ?? propertyMap.value.get(field.key)
        return fieldToSchemaNode(field, property)
      })
  }

  /** Schema nodes for flat (non-wizard) layouts */
  const schemaFields = computed(() => {
    return convertFields(config.value.fields ?? [])
  })

  /** Schema nodes organized by step for wizard layout */
  const stepSchemas = computed(() => {
    if (!config.value.steps) return []
    return config.value.steps.map((step) => ({
      key: step.key,
      label: step.label,
      description: step.description,
      icon: step.icon,
      fields: convertFields(step.fields),
    }))
  })

  return {
    schemaFields,
    stepSchemas,
    convertFields,
    evaluateCondition: (condition: ConditionExpression) =>
      evaluateCondition(condition, formValues.value),
  }
}
