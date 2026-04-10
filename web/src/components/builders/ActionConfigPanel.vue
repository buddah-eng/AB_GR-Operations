<template>
  <div v-if="action" class="p-4 space-y-4">
    <div class="text-sm font-semibold text-surface-800 pb-2 border-b border-surface-100">
      {{ getActionTypeLabel(action.type) }} Configuration
    </div>

    <!-- Action label -->
    <div>
      <label class="text-xs font-medium text-surface-500 block mb-1">
        Label
      </label>
      <InputText
        :model-value="action.label"
        :placeholder="getActionTypeLabel(action.type)"
        class="w-full"
        @update:model-value="(v) => emitConfigChange('label', v)"
      />
    </div>

    <!-- create_record / update_record -->
    <template v-if="action.type === 'create_record' || action.type === 'update_record'">
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Target Concept
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Target Concept
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Template
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Recipients (role)
        </label>
        <InputText
          :model-value="(action.config['recipientRole'] as string) ?? ''"
          placeholder="e.g. liaison"
          class="w-full"
          @update:model-value="(v) => emitConfigChange('recipientRole', v)"
        />
      </div>
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Template
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Integration
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Template
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Calendar Integration
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Source Concept
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Match Field
        </label>
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
      <div>
        <label class="text-xs font-medium text-surface-500 block mb-1">
          Target Concept
        </label>
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

  <!-- No action selected -->
  <div
    v-else
    class="flex flex-col items-center justify-center h-full text-surface-400 p-4"
  >
    <i class="pi pi-arrow-left text-2xl mb-2" />
    <p class="text-sm text-center">
      Click an action in the chain to configure it
    </p>
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
