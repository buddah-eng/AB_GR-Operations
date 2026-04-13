<template>
  <div class="formkit-primevue-autocomplete">
    <AutoComplete
      :model-value="modelValue"
      :suggestions="filteredSuggestions"
      :multiple="isMultiple"
      :disabled="context.disabled"
      :placeholder="String(context.attrs.placeholder ?? '')"
      :force-selection="forceSelection"
      :dropdown="true"
      :option-label="optionLabelField"
      :option-value="optionValueField"
      :input-id="context.id"
      :aria-label="context.label"
      @complete="handleComplete"
      @update:model-value="handleChange"
      @blur="context.handlers.blur"
    >
      <template v-if="hasOptionTemplate" #option="{ option }">
        <div class="fk-ac-option">
          <span v-if="option.icon" class="fk-ac-option-icon pi" :class="option.icon" />
          <div class="fk-ac-option-content">
            <span class="fk-ac-option-label">{{ option[optionLabelField] }}</span>
            <span v-if="option.description" class="fk-ac-option-desc">
              {{ option.description }}
            </span>
          </div>
        </div>
      </template>
    </AutoComplete>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import AutoComplete from 'primevue/autocomplete'
import type { AutoCompleteCompleteEvent } from 'primevue/autocomplete'

interface OptionItem {
  label: string
  value: string
  icon?: string
  description?: string
  [key: string]: unknown
}

interface FormKitContext {
  _value: unknown
  value: unknown
  node: { input: (value: unknown) => void }
  handlers: { blur: () => void; DOMInput: (e: Event) => void }
  disabled: boolean
  id: string
  label: string
  attrs: Record<string, unknown>
}

const props = defineProps<{
  context: FormKitContext
}>()

const optionLabelField = computed<string>(
  () => (props.context.attrs.optionLabel as string) ?? 'label',
)

const optionValueField = computed<string>(
  () => (props.context.attrs.optionValue as string) ?? 'value',
)

const isMultiple = computed<boolean>(
  () => (props.context.attrs.multiple as boolean) ?? false,
)

const forceSelection = computed<boolean>(
  () => (props.context.attrs.forceSelection as boolean) ?? false,
)

const suggestionsUrl = computed<string | undefined>(
  () => props.context.attrs.suggestionsUrl as string | undefined,
)

const staticOptions = computed<OptionItem[]>(() => {
  const raw = props.context.attrs.options
  if (Array.isArray(raw)) return raw as OptionItem[]
  return []
})

const hasOptionTemplate = computed<boolean>(() =>
  staticOptions.value.some(
    (opt) => opt.icon !== undefined || opt.description !== undefined,
  ),
)

const filteredSuggestions = ref<OptionItem[]>([])

const modelValue = computed(() => {
  const val = props.context._value
  if (val === undefined || val === null) {
    return isMultiple.value ? [] : null
  }
  return val
})

async function handleComplete(event: AutoCompleteCompleteEvent): Promise<void> {
  const query = event.query.toLowerCase()

  if (suggestionsUrl.value) {
    try {
      const url = new URL(suggestionsUrl.value)
      url.searchParams.set('q', event.query)
      const response = await fetch(url.toString())
      const data: OptionItem[] = await response.json()
      filteredSuggestions.value = data
    } catch {
      filteredSuggestions.value = []
    }
    return
  }

  filteredSuggestions.value = staticOptions.value.filter((opt) => {
    const label = String(opt[optionLabelField.value] ?? '').toLowerCase()
    return label.includes(query)
  })
}

function handleChange(selected: unknown): void {
  if (isMultiple.value && Array.isArray(selected)) {
    const values = selected.map((item) => {
      if (typeof item === 'object' && item !== null) {
        return (item as OptionItem)[optionValueField.value]
      }
      return item
    })
    props.context.node.input(values)
    return
  }

  if (typeof selected === 'object' && selected !== null) {
    props.context.node.input(
      (selected as OptionItem)[optionValueField.value],
    )
    return
  }

  props.context.node.input(selected ?? '')
}
</script>

<style scoped>
.formkit-primevue-autocomplete {
  width: 100%;
}

.formkit-primevue-autocomplete :deep(.p-autocomplete) {
  width: 100%;
}

.fk-ac-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.fk-ac-option-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.fk-ac-option-content {
  display: flex;
  flex-direction: column;
}

.fk-ac-option-label {
  font-size: var(--text-sm);
}

.fk-ac-option-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
