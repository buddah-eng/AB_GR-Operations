<template>
  <div v-if="action" class="action-config">
    <div class="action-config__title section-header">
      {{ getActionTypeLabel(action.type) }} Configuration
    </div>

    <div class="action-config__fields">
      <!-- Action label -->
      <div class="form-field">
        <label>Label</label>
        <InputText
          :model-value="action.label"
          :placeholder="getActionTypeLabel(action.type)"
          class="w-full"
          @update:model-value="(v) => emitConfigChange('label', v)"
        />
      </div>

      <!-- create_record / update_record -->
      <template v-if="action.type === 'create_record' || action.type === 'update_record'">
        <div class="form-field">
          <label>Target Concept</label>
          <Select
            :model-value="(action.config['targetConcept'] as string) ?? ''"
            :options="concepts"
            option-label="label"
            option-value="key"
            placeholder="Select concept"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('targetConcept', v)"
          />
        </div>
      </template>

      <!-- create_records -->
      <template v-if="action.type === 'create_records'">
        <div class="form-field">
          <label>Target Concept</label>
          <Select
            :model-value="(action.config['targetConcept'] as string) ?? ''"
            :options="concepts"
            option-label="label"
            option-value="key"
            placeholder="Select concept"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('targetConcept', v)"
          />
        </div>
        <div class="form-field">
          <label>Template</label>
          <InputText
            :model-value="(action.config['templateName'] as string) ?? ''"
            placeholder="Template name"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('templateName', v)"
          />
        </div>
      </template>

      <!-- notify -->
      <template v-if="action.type === 'notify'">
        <div class="form-field">
          <label>Recipients (role)</label>
          <InputText
            :model-value="(action.config['recipientRole'] as string) ?? ''"
            placeholder="e.g. liaison"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('recipientRole', v)"
          />
        </div>
        <div class="form-field">
          <label>Template</label>
          <InputText
            :model-value="(action.config['templateName'] as string) ?? ''"
            placeholder="Notification template name"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('templateName', v)"
          />
        </div>
      </template>

      <!-- call_api -->
      <template v-if="action.type === 'call_api'">
        <div class="form-field">
          <label>Integration</label>
          <InputText
            :model-value="(action.config['integrationName'] as string) ?? ''"
            placeholder="Integration name"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('integrationName', v)"
          />
        </div>
      </template>

      <!-- generate_doc -->
      <template v-if="action.type === 'generate_doc'">
        <div class="form-field">
          <label>Template</label>
          <InputText
            :model-value="(action.config['templateName'] as string) ?? ''"
            placeholder="Document template"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('templateName', v)"
          />
        </div>
      </template>

      <!-- sync_calendar -->
      <template v-if="action.type === 'sync_calendar'">
        <div class="form-field">
          <label>Calendar Integration</label>
          <InputText
            :model-value="(action.config['calendarId'] as string) ?? ''"
            placeholder="Calendar ID"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('calendarId', v)"
          />
        </div>
      </template>

      <!-- lookup_registry -->
      <template v-if="action.type === 'lookup_registry'">
        <div class="form-field">
          <label>Source Concept</label>
          <Select
            :model-value="(action.config['sourceConcept'] as string) ?? ''"
            :options="concepts"
            option-label="label"
            option-value="key"
            placeholder="Select concept"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('sourceConcept', v)"
          />
        </div>
        <div class="form-field">
          <label>Match Field</label>
          <InputText
            :model-value="(action.config['matchField'] as string) ?? ''"
            placeholder="Field to match on"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('matchField', v)"
          />
        </div>
      </template>

      <!-- delete_record -->
      <template v-if="action.type === 'delete_record'">
        <div class="form-field">
          <label>Target Concept</label>
          <Select
            :model-value="(action.config['targetConcept'] as string) ?? ''"
            :options="concepts"
            option-label="label"
            option-value="key"
            placeholder="Select concept"
            class="w-full"
            @update:model-value="(v) => emitConfigChange('targetConcept', v)"
          />
        </div>
      </template>
    </div>
  </div>

  <!-- No action selected -->
  <div v-else class="empty-state">
    <div class="icon">
      <i class="pi pi-arrow-left" />
    </div>
    <p>Click an action in the chain to configure it</p>
  </div>
</template>

<script setup lang="ts">
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import type { ActionType } from '@/types/workflow'
import { ACTION_TYPE_INFO } from '@/types/workflow'

/* ---- Props ---- */

export interface ActionData {
  readonly id: string
  readonly type: ActionType
  readonly label: string
  readonly config: Record<string, unknown>
  readonly position: number
}

export interface ConceptOption {
  readonly key: string
  readonly label: string
}

defineProps<{
  /** The currently selected action, or null if none is selected */
  action: ActionData | null
  /** Ontology concepts for Select dropdowns */
  concepts: ConceptOption[]
}>()

/* ---- Emits ---- */

const emit = defineEmits<{
  /** Emitted when the label field is changed */
  'update:label': [value: string]
  /** Emitted when a config key is changed */
  'update:config': [key: string, value: unknown]
}>()

/* ---- Helpers ---- */

function getActionTypeLabel(type: ActionType): string {
  return ACTION_TYPE_INFO.find((a) => a.type === type)?.label ?? type
}

function emitConfigChange(key: string, value: unknown): void {
  if (key === 'label') {
    emit('update:label', String(value))
  } else {
    emit('update:config', key, value)
  }
}
</script>

<style scoped>
.action-config {
  padding: var(--space-5);
}

.action-config__title {
  margin-bottom: var(--space-4);
}

.action-config__fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
