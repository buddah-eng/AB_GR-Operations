/* ------------------------------------------------------------------ */
/*  Shared types for FormKit custom PrimeVue inputs                   */
/* ------------------------------------------------------------------ */

/** Context object passed to FormKit custom input components */
export interface FormKitContext {
  _value: unknown
  value: unknown
  node: { input: (value: unknown) => void }
  handlers: { blur: () => void; DOMInput: (e: Event) => void }
  disabled: boolean
  id: string
  label: string
  attrs: Record<string, unknown>
}
