<template>
  <div class="formkit-primevue-toggle">
    <ToggleSwitch
      :model-value="booleanValue"
      :disabled="context.disabled"
      :input-id="context.id"
      :aria-label="context.label"
      @update:model-value="handleChange"
    />
    <label
      v-if="toggleLabel"
      :for="context.id"
      class="fk-toggle-label"
      :class="{ 'fk-toggle-label--disabled': context.disabled }"
    >
      {{ toggleLabel }}
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ToggleSwitch from 'primevue/toggleswitch'

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

const toggleLabel = computed<string>(
  () => (props.context.attrs.toggleLabel as string) ?? '',
)

const booleanValue = computed<boolean>(() => {
  const raw = props.context._value
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === 1) return true
  return false
})

function handleChange(value: boolean): void {
  props.context.node.input(value)
}
</script>

<style scoped>
.formkit-primevue-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.fk-toggle-label {
  font-size: var(--text-sm);
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.fk-toggle-label--disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}
</style>
