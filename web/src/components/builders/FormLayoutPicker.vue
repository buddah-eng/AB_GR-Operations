<template>
  <div class="layout-picker">
    <SelectButton
      :model-value="modelValue"
      :options="layoutOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      aria-label="Layout mode"
      @update:model-value="(v) => emit('update:modelValue', v)"
    />
  </div>
</template>

<script setup lang="ts">
import SelectButton from 'primevue/selectbutton'
import type { FormLayout } from '@/types/forms'

defineProps<{
  modelValue: FormLayout
}>()

const emit = defineEmits<{
  'update:modelValue': [value: FormLayout]
}>()

const layoutOptions = [
  { label: 'Single', value: 'single-column' as FormLayout },
  { label: 'Two Column', value: 'two-column' as FormLayout },
  { label: 'Wizard', value: 'wizard' as FormLayout },
]
</script>

<style scoped>
.layout-picker {
  display: inline-flex;
}
</style>
