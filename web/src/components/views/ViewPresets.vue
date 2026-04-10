<template>
  <div class="view-presets inline-flex items-center gap-2">
    <!-- Preset selector -->
    <Select
      v-model="selectedPresetId"
      :options="presetOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Select view preset"
      class="w-48"
      :aria-label="'View preset selector'"
      @change="handlePresetChange"
    />

    <!-- Save preset button -->
    <Button
      icon="pi pi-save"
      severity="secondary"
      text
      rounded
      size="small"
      aria-label="Save current view as preset"
      @click="showSaveDialog = true"
    />

    <!-- Save dialog -->
    <Dialog
      v-model:visible="showSaveDialog"
      header="Save View Preset"
      :modal="true"
      :style="{ width: '24rem' }"
    >
      <div class="space-y-4">
        <div class="flex flex-col gap-2">
          <label for="preset-name" class="text-sm font-medium text-surface-700">
            Preset name
          </label>
          <InputText
            id="preset-name"
            v-model="newPresetName"
            placeholder="Enter a name for this preset"
            aria-required="true"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="preset-description" class="text-sm font-medium text-surface-700">
            Description (optional)
          </label>
          <InputText
            id="preset-description"
            v-model="newPresetDescription"
            placeholder="Describe this view configuration"
          />
        </div>
      </div>

      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="showSaveDialog = false"
        />
        <Button
          label="Save"
          icon="pi pi-check"
          :disabled="!newPresetName.trim()"
          @click="handleSave"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'

import type { ViewPreset } from '@/types/views'

interface Props {
  presets: ViewPreset[]
  activePresetId?: string
}

const props = withDefaults(defineProps<Props>(), {
  activePresetId: undefined,
})

const emit = defineEmits<{
  select: [preset: ViewPreset]
  save: [preset: Omit<ViewPreset, 'id'>]
}>()

const selectedPresetId = ref<string | null>(props.activePresetId ?? null)
const showSaveDialog = ref(false)
const newPresetName = ref('')
const newPresetDescription = ref('')

watch(
  () => props.activePresetId,
  (newId) => {
    selectedPresetId.value = newId ?? null
  },
)

const presetOptions = computed(() =>
  props.presets.map((p) => ({
    label: p.name,
    value: p.id,
  })),
)

function handlePresetChange(): void {
  if (!selectedPresetId.value) return
  const preset = props.presets.find((p) => p.id === selectedPresetId.value)
  if (preset) {
    emit('select', preset)
  }
}

function handleSave(): void {
  const name = newPresetName.value.trim()
  if (!name) return

  emit('save', {
    name,
    description: newPresetDescription.value.trim() || undefined,
    viewType: 'table',
  })

  showSaveDialog.value = false
  newPresetName.value = ''
  newPresetDescription.value = ''
}
</script>
