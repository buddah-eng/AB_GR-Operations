/* ------------------------------------------------------------------ */
/*  Dynamic form type definitions                                      */
/* ------------------------------------------------------------------ */

import type { OntologyProperty } from '@/types'

/** Layout mode for a dynamic form */
export type FormLayout = 'single-column' | 'two-column' | 'wizard'

/** Condition expression used for conditional visibility (showIf) */
export interface ConditionExpression {
  type: 'comparison' | 'and' | 'or' | 'not'
  field?: string
  operator?: ConditionOperator
  value?: unknown
  children?: ConditionExpression[]
  child?: ConditionExpression
}

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_empty'
  | 'is_not_empty'
  | 'in'
  | 'not_in'
  | 'between'

/** Configuration for a single form field */
export interface FormFieldConfig {
  /** Property key from ontology */
  key: string
  /** Display label override (uses property label if omitted) */
  label?: string
  /** Placeholder text override */
  placeholder?: string
  /** Whether the field is required */
  required?: boolean
  /** Whether the field is read-only */
  readOnly?: boolean
  /** Whether the field is hidden */
  hidden?: boolean
  /** Help text shown below the input */
  helpText?: string
  /** Default value */
  defaultValue?: unknown
  /** Column span in two-column layout (1 or 2) */
  colSpan?: 1 | 2
  /** Conditional visibility expression */
  showIf?: ConditionExpression
  /** Ontology property reference (resolved at runtime) */
  property?: OntologyProperty
}

/** A single step in a wizard form */
export interface FormStep {
  key: string
  label: string
  description?: string
  icon?: string
  fields: FormFieldConfig[]
}

/** Top-level form configuration */
export interface FormConfig {
  /** Unique form identifier */
  id: string
  /** Form title shown in header */
  title: string
  /** Optional description */
  description?: string
  /** Layout mode */
  layout: FormLayout
  /** Fields for single/two-column layouts */
  fields?: FormFieldConfig[]
  /** Steps for wizard layout */
  steps?: FormStep[]
  /** Concept key from ontology (used to resolve properties) */
  conceptKey?: string
  /** Whether to show a cancel button */
  showCancel?: boolean
  /** Submit button label */
  submitLabel?: string
  /** Cancel button label */
  cancelLabel?: string
}

/**
 * Property-type to FormKit input-type mapping.
 * Maps the 17 ontology property types to FormKit input types.
 */
export const PROPERTY_TYPE_INPUT_MAP: Record<string, string> = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  integer: 'number',
  decimal: 'number',
  boolean: 'primeToggle',
  date: 'primeDatePicker',
  datetime: 'primeDatePicker',
  time: 'time',
  email: 'email',
  url: 'url',
  phone: 'tel',
  select: 'select',
  multi_select: 'primeTagList',
  radio: 'radio',
  currency: 'number',
  percentage: 'number',
  relation: 'primeAutocomplete',
  checkbox: 'primeToggle',
}
