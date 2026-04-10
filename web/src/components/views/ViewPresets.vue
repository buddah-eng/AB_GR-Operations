<template>
  <div class="vp-root">
    <!-- Preset selector -->
    <Select
      v-model="selectedPresetId"
      :options="presetOptions"
      optionLabel="label"
      optionValue="value"
      placeholder="Select view preset"
      class="vp-select"
      aria-label="View preset selector"
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
      class="vp-save-btn"
      @click="showSaveDialog = true"
    />

    <!-- Save dialog -->
    <Dialog
      v-model:visible="showSaveDialog"
      header="Save View Preset"
      :modal="true"
      :style="{ width: '26rem' }"
      :pt="{ root: { class: 'vp-dialog' } }"
    >
      <div class="vp-dialog-body">
        <div class="vp-form-field form-field">
          <label for="preset-name" class="vp-field-label">
            Preset name
            <span class="vp-required" aria-hidden="true" />
          </label>
          <InputText
            id="preset-name"
            v-model="newPresetName"
            placeholder="Enter a name for this preset"
            aria-required="true"
          />
        </div>
        <div class="vp-form-field form-field">
          <label for="preset-description" class="vp-field-label">
            Description
            <span class="vp-optional">(optional)</span>
          </label>
          <InputText
            id="preset-description"
            v-model="newPresetDescription"
            placeholder="Describe this view configuration"
          />
        </div>
      </div>

      <template #footer>
        <div class="vp-dialog-footer">
          <Button
            label="Cancel"
            severity="secondary"
            text
            @click="showSaveDialog = false"
          />
          <Button
            label="Save Preset"
            icon="pi pi-check"
            :disabled="!newPresetName.trim()"
            @click="handleSave"
          />
        </div>
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

<style scoped>
.vp-root {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.vp-select {
  width: 12rem;
  font-family: var(--font-display);
  font-size: var(--text-sm);
}

.vp-save-btn {
  transition: color var(--duration-normal) var(--ease-default);
}

/* Dialog body */
.vp-dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.vp-form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.vp-field-label {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  letter-spacing: var(--tracking-wide);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* Required dot indicator */
.vp-required {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent-400);
}

.vp-optional {
  font-weight: var(--weight-normal);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

/* Dialog footer */
.vp-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}
</style>
