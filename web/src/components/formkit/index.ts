/* ------------------------------------------------------------------ */
/*  FormKit custom inputs plugin                                       */
/*  Wraps PrimeVue components as FormKit-compatible inputs             */
/* ------------------------------------------------------------------ */

import type { FormKitPlugin } from '@formkit/core'
import { createInput } from '@formkit/vue'

import AutocompleteInput from './AutocompleteInput.vue'
import DatePickerInput from './DatePickerInput.vue'
import ToggleInput from './ToggleInput.vue'
import TagListInput from './TagListInput.vue'

/** PrimeVue AutoComplete wrapped for FormKit */
const primeAutocomplete = createInput(AutocompleteInput, {
  props: [
    'options',
    'suggestionsUrl',
    'multiple',
    'forceSelection',
    'optionLabel',
    'optionValue',
  ],
})

/** PrimeVue DatePicker wrapped for FormKit */
const primeDatePicker = createInput(DatePickerInput, {
  props: [
    'minDate',
    'maxDate',
    'selectionMode',
    'showTime',
    'showIcon',
    'timeOnly',
    'dateFormat',
  ],
})

/** PrimeVue ToggleSwitch wrapped for FormKit */
const primeToggle = createInput(ToggleInput, {
  props: ['toggleLabel'],
})

/** PrimeVue Chips wrapped for FormKit */
const primeTagList = createInput(TagListInput, {
  props: ['maxTags', 'maxTagLength', 'separator'],
})

/**
 * FormKit plugin that registers all PrimeVue custom inputs.
 * Usage: pass in defaultConfig({ plugins: [primeInputsPlugin] })
 */
export const primeInputsPlugin: FormKitPlugin = (node) => {
  // Plugin runs on every node; we only define inputs at the root
  if (node.props.type === 'primeAutocomplete') {
    node.define(primeAutocomplete)
  }
  if (node.props.type === 'primeDatePicker') {
    node.define(primeDatePicker)
  }
  if (node.props.type === 'primeToggle') {
    node.define(primeToggle)
  }
  if (node.props.type === 'primeTagList') {
    node.define(primeTagList)
  }
}

export {
  primeAutocomplete,
  primeDatePicker,
  primeToggle,
  primeTagList,
}
