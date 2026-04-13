<template>
  <div class="formkit-primevue-datepicker">
    <DatePicker
      :model-value="dateValue"
      :disabled="context.disabled"
      :placeholder="String(context.attrs.placeholder ?? '')"
      :min-date="parsedMinDate"
      :max-date="parsedMaxDate"
      :selection-mode="selectionMode"
      :show-time="showTime"
      :show-icon="showIcon"
      :time-only="timeOnly"
      :date-format="dateFormat"
      :input-id="context.id"
      :aria-label="context.label"
      @update:model-value="handleChange"
      @blur="context.handlers.blur"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DatePicker from 'primevue/datepicker'

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

const selectionMode = computed<'single' | 'range' | 'multiple'>(
  () => (props.context.attrs.selectionMode as 'single' | 'range' | 'multiple') ?? 'single',
)

const showTime = computed<boolean>(
  () => (props.context.attrs.showTime as boolean) ?? false,
)

const showIcon = computed<boolean>(
  () => (props.context.attrs.showIcon as boolean) ?? true,
)

const timeOnly = computed<boolean>(
  () => (props.context.attrs.timeOnly as boolean) ?? false,
)

const dateFormat = computed<string>(
  () => (props.context.attrs.dateFormat as string) ?? 'mm/dd/yy',
)

const parsedMinDate = computed<Date | undefined>(() => {
  const raw = props.context.attrs.minDate
  if (!raw) return undefined
  if (raw instanceof Date) return raw
  if (typeof raw === 'string') return new Date(raw)
  return undefined
})

const parsedMaxDate = computed<Date | undefined>(() => {
  const raw = props.context.attrs.maxDate
  if (!raw) return undefined
  if (raw instanceof Date) return raw
  if (typeof raw === 'string') return new Date(raw)
  return undefined
})

const dateValue = computed<Date | Date[] | null>(() => {
  const raw = props.context._value

  if (raw === undefined || raw === null || raw === '') {
    return null
  }

  if (raw instanceof Date) return raw

  if (typeof raw === 'string') {
    const parsed = new Date(raw)
    return isNaN(parsed.getTime()) ? null : parsed
  }

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (item instanceof Date) return item
        if (typeof item === 'string') {
          const parsed = new Date(item)
          return isNaN(parsed.getTime()) ? null : parsed
        }
        return null
      })
      .filter((d): d is Date => d !== null)
  }

  return null
})

function toISOString(date: Date): string {
  return date.toISOString()
}

function handleChange(
  value: Date | Date[] | Array<Date | null> | null | undefined,
): void {
  if (value === null || value === undefined) {
    props.context.node.input('')
    return
  }

  if (Array.isArray(value)) {
    const isoValues: string[] = []
    for (const d of value) {
      if (d instanceof Date && !isNaN(d.getTime())) {
        isoValues.push(toISOString(d))
      }
    }
    props.context.node.input(isoValues)
    return
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    props.context.node.input(toISOString(value))
    return
  }

  props.context.node.input('')
}
</script>

<style scoped>
.formkit-primevue-datepicker {
  width: 100%;
}

.formkit-primevue-datepicker :deep(.p-datepicker) {
  width: 100%;
}
</style>
