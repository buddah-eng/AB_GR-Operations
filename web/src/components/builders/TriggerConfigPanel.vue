<template>
  <div class="trigger-panel">
    <!-- Trigger type -->
    <div class="trigger-section">
      <h3 class="trigger-section-label">Trigger</h3>
      <div class="trigger-list">
        <div
          v-for="triggerInfo in triggerTypeInfoList"
          :key="triggerInfo.type"
          :class="['trigger-option', selectedTriggerType === triggerInfo.type ? 'trigger-option--active' : '']"
          :aria-label="`Select trigger: ${triggerInfo.label}`"
          role="radio"
          :aria-checked="selectedTriggerType === triggerInfo.type"
          @click="emit('update:triggerType', triggerInfo.type)"
        >
          <i :class="[triggerInfo.icon, 'trigger-option__icon']" />
          <div>
            <div class="trigger-option__label">{{ triggerInfo.label }}</div>
            <div class="trigger-option__desc">{{ triggerInfo.description }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Trigger config -->
    <div class="trigger-config">
      <template v-if="selectedTriggerType === 'domain_event'">
        <div class="trigger-config-fields">
          <div class="form-field">
            <label>Concept</label>
            <Select
              :model-value="triggerConceptKey"
              :options="concepts"
              option-label="label"
              option-value="key"
              placeholder="Select concept"
              class="w-full"
              @update:model-value="(v) => emit('update:conceptKey', v)"
            />
          </div>
          <div class="form-field">
            <label>Event</label>
            <Select
              :model-value="triggerEventName"
              :options="domainEventOptions"
              option-label="label"
              option-value="value"
              placeholder="Select event"
              class="w-full"
              @update:model-value="(v) => emit('update:eventName', v)"
            />
          </div>
        </div>
      </template>

      <template v-if="selectedTriggerType === 'field_changed'">
        <div class="trigger-config-fields">
          <div class="form-field">
            <label>Concept</label>
            <Select
              :model-value="triggerConceptKey"
              :options="concepts"
              option-label="label"
              option-value="key"
              placeholder="Select concept"
              class="w-full"
              @update:model-value="(v) => emit('update:conceptKey', v)"
            />
          </div>
          <div class="form-field">
            <label>Field</label>
            <Select
              :model-value="triggerFieldName"
              :options="conceptProperties"
              option-label="label"
              option-value="key"
              placeholder="Select field"
              class="w-full"
              @update:model-value="(v) => emit('update:fieldName', v)"
            />
          </div>
        </div>
      </template>

      <template v-if="selectedTriggerType === 'scheduled'">
        <div class="trigger-config-fields">
          <div class="form-field">
            <label>Schedule</label>
            <Select
              :model-value="schedulePreset"
              :options="schedulePresets"
              option-label="label"
              option-value="value"
              placeholder="Select schedule"
              class="w-full"
              @update:model-value="(v) => emit('update:schedulePreset', v)"
            />
          </div>
          <div class="form-field">
            <label>Custom Cron</label>
            <InputText
              :model-value="triggerSchedule"
              placeholder="*/15 * * * *"
              class="w-full"
              @update:model-value="(v) => emit('update:schedule', String(v))"
            />
          </div>
          <div v-if="triggerSchedule" class="trigger-cron-preview">
            {{ humanReadableCron }}
          </div>
        </div>
      </template>

      <template v-if="selectedTriggerType === 'manual'">
        <div class="trigger-config-fields">
          <div class="form-field">
            <label>Button Label</label>
            <InputText
              :model-value="triggerButtonLabel"
              placeholder="Run workflow"
              class="w-full"
              @update:model-value="(v) => emit('update:buttonLabel', String(v))"
            />
          </div>
          <div class="form-field">
            <label>Description</label>
            <InputText
              :model-value="triggerDescription"
              placeholder="What this workflow does"
              class="w-full"
              @update:model-value="(v) => emit('update:description', String(v))"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Condition -->
    <div class="trigger-condition-section">
      <h3 class="trigger-section-label">Only run when...</h3>
      <ConditionBuilder
        :model-value="condition"
        :properties="conceptProperties"
        @update:model-value="(v) => emit('update:condition', v)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression } from '@/types/forms'
import type { TriggerType } from '@/types/workflow'
import { TRIGGER_TYPE_INFO } from '@/types/workflow'
import ConditionBuilder from '@/components/conditions/ConditionBuilder.vue'

const props = defineProps<{
  selectedTriggerType: TriggerType
  triggerConceptKey: string
  triggerEventName: string
  triggerFieldName: string
  triggerSchedule: string
  triggerButtonLabel: string
  triggerDescription: string
  schedulePreset: string
  condition: ConditionExpression | null
  concepts: Array<{ key: string; label: string }>
  conceptProperties: OntologyProperty[]
}>()

const emit = defineEmits<{
  'update:triggerType': [value: TriggerType]
  'update:conceptKey': [value: string]
  'update:eventName': [value: string]
  'update:fieldName': [value: string]
  'update:schedule': [value: string]
  'update:schedulePreset': [value: string]
  'update:buttonLabel': [value: string]
  'update:description': [value: string]
  'update:condition': [value: ConditionExpression | null]
}>()

const triggerTypeInfoList = [...TRIGGER_TYPE_INFO]

const domainEventOptions = [
  { label: 'Created', value: 'created' },
  { label: 'Updated', value: 'updated' },
  { label: 'Deleted', value: 'deleted' },
  { label: 'Status Changed', value: 'status_changed' },
]

const schedulePresets = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Monday)', value: '0 0 * * 1' },
]

const humanReadableCron = computed(() => {
  const cron = props.triggerSchedule.trim()
  if (!cron) return ''
  const preset = schedulePresets.find((p) => p.value === cron)
  if (preset) return preset.label
  return `Custom: ${cron}`
})
</script>

<style scoped>
.trigger-panel {
  padding: var(--space-5);
}

.trigger-section {
  margin-bottom: var(--space-6);
}

.trigger-section-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--text-muted);
  margin-bottom: var(--space-3);
}

.trigger-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.trigger-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
  border: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
}

.trigger-option:hover {
  border-color: var(--surface-300);
  box-shadow: var(--shadow-xs);
}

.trigger-option--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  box-shadow: 0 0 0 3px var(--primary-100);
}

.trigger-option__icon {
  font-size: var(--text-sm);
  margin-top: 2px;
  color: var(--text-secondary);
}

.trigger-option--active .trigger-option__icon {
  color: var(--primary-600);
}

.trigger-option__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.trigger-option__desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: var(--leading-snug);
}

.trigger-config {
  margin-bottom: var(--space-6);
}

.trigger-config-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.trigger-cron-preview {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--surface-100);
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
}

.trigger-condition-section .trigger-section-label {
  margin-bottom: var(--space-2);
}
</style>
