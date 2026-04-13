<template>
  <div class="formkit-primevue-taglist">
    <Chips
      :model-value="chipValues"
      :disabled="context.disabled"
      :placeholder="String(context.attrs.placeholder ?? '')"
      :max="maxTags"
      :separator="separatorKeys"
      :input-id="context.id"
      :aria-label="context.label"
      :allow-duplicate="false"
      @update:model-value="handleChange"
      @blur="context.handlers.blur"
    />
    <small v-if="limitMessage" class="fk-taglist-limit">
      {{ limitMessage }}
    </small>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Chips from 'primevue/chips'
import type { FormKitContext } from './types'

const props = defineProps<{
  context: FormKitContext
}>()

const maxTags = computed<number | undefined>(
  () => (props.context.attrs.maxTags as number) ?? undefined,
)

const maxTagLength = computed<number | undefined>(
  () => (props.context.attrs.maxTagLength as number) ?? undefined,
)

const separatorKeys = computed<string>(
  () => (props.context.attrs.separator as string) ?? ',',
)

const chipValues = computed<string[]>(() => {
  const raw = props.context._value
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string')
  return []
})

const limitMessage = computed<string>(() => {
  const parts: string[] = []
  if (maxTags.value !== undefined) {
    parts.push(`Max ${maxTags.value} tags`)
  }
  if (maxTagLength.value !== undefined) {
    parts.push(`${maxTagLength.value} chars each`)
  }
  return parts.join(', ')
})

function truncateTag(tag: string): string {
  if (maxTagLength.value !== undefined && tag.length > maxTagLength.value) {
    return tag.slice(0, maxTagLength.value)
  }
  return tag
}

function handleChange(value: string[]): void {
  const processed = value.map(truncateTag)
  props.context.node.input(processed)
}
</script>

<style scoped>
.formkit-primevue-taglist {
  width: 100%;
}

.formkit-primevue-taglist :deep(.p-chips) {
  width: 100%;
}

.fk-taglist-limit {
  display: block;
  margin-top: 0.25rem;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
</style>
