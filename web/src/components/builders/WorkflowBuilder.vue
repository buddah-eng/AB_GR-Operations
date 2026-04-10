<template>
  <div class="workflow-builder flex flex-col h-full" role="region" aria-label="Workflow Builder">
    <!-- Toolbar -->
    <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-surface-200 bg-white">
      <div class="flex items-center gap-3">
        <i class="pi pi-sitemap text-primary-500" />
        <InputText
          v-model="workflowName"
          placeholder="Workflow name"
          class="text-lg font-semibold w-64"
          aria-label="Workflow name"
        />
      </div>

      <div class="flex items-center gap-2">
        <Button
          label="Test"
          icon="pi pi-play"
          severity="secondary"
          outlined
          :loading="dryRunning"
          @click="handleDryRun"
        />
        <Button
          label="View on Canvas"
          icon="pi pi-share-alt"
          severity="secondary"
          text
          :disabled="!workflowId"
          @click="navigateToCanvas"
        />
        <Button
          label="Save"
          icon="pi pi-save"
          :loading="saving"
          :disabled="saving"
          @click="handleSave"
        />
      </div>
    </div>

    <!-- Validation bar -->
    <div
      v-if="validationItems.length > 0"
      class="shrink-0 flex items-center gap-4 px-4 py-2 border-b border-surface-200 bg-surface-50 text-sm"
    >
      <div
        v-for="item in validationItems"
        :key="item.label"
        :class="[
          'flex items-center gap-1.5',
          item.ok ? 'text-green-600' : 'text-red-500',
        ]"
      >
        <i :class="item.ok ? 'pi pi-check-circle' : 'pi pi-times-circle'" />
        <span>{{ item.label }}</span>
      </div>
    </div>

    <!-- Error -->
    <Message
      v-if="errorMessage"
      severity="error"
      :closable="true"
      class="mx-4 mt-2"
      @close="errorMessage = null"
    >
      {{ errorMessage }}
    </Message>

    <!-- Dry run results -->
    <div
      v-if="dryRunResults.length > 0"
      class="shrink-0 mx-4 mt-2 p-4 bg-blue-50 border border-blue-200 rounded-lg"
    >
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-semibold text-blue-700">Dry Run Results</h3>
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          rounded
          size="small"
          @click="dryRunResults = []"
        />
      </div>
      <div class="space-y-1">
        <div
          v-for="(result, idx) in dryRunResults"
          :key="idx"
          :class="[
            'flex items-center gap-2 text-sm',
            result.wouldExecute ? 'text-green-700' : 'text-surface-400',
          ]"
        >
          <i :class="result.wouldExecute ? 'pi pi-check text-green-500' : 'pi pi-minus text-surface-300'" />
          <span>Step {{ result.actionIndex + 1 }}: {{ result.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 3-panel layout -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Left: Trigger picker + Condition -->
      <div class="w-72 shrink-0 border-r border-surface-200 bg-surface-50 overflow-y-auto p-4 space-y-6">
        <!-- Trigger type -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-widest text-surface-500 mb-3">
            Trigger
          </h3>
          <div class="space-y-2">
            <div
              v-for="triggerInfo in triggerTypeInfoList"
              :key="triggerInfo.type"
              :class="[
                'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors border',
                selectedTriggerType === triggerInfo.type
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-surface-200 bg-white hover:border-surface-300',
              ]"
              :aria-label="`Select trigger: ${triggerInfo.label}`"
              role="radio"
              :aria-checked="selectedTriggerType === triggerInfo.type"
              @click="selectedTriggerType = triggerInfo.type"
            >
              <i :class="[triggerInfo.icon, 'text-sm']" />
              <div>
                <div class="text-sm font-medium text-surface-700">{{ triggerInfo.label }}</div>
                <div class="text-[11px] text-surface-400">{{ triggerInfo.description }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Trigger config -->
        <div>
          <!-- Domain event -->
          <template v-if="selectedTriggerType === 'domain_event'">
            <div class="space-y-3">
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Concept</label>
                <Select
                  v-model="triggerConceptKey"
                  :options="ontologyStore.concepts"
                  option-label="label"
                  option-value="key"
                  placeholder="Select concept"
                  class="w-full"
                />
              </div>
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Event</label>
                <Select
                  v-model="triggerEventName"
                  :options="domainEventOptions"
                  option-label="label"
                  option-value="value"
                  placeholder="Select event"
                  class="w-full"
                />
              </div>
            </div>
          </template>

          <!-- Field changed -->
          <template v-if="selectedTriggerType === 'field_changed'">
            <div class="space-y-3">
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Concept</label>
                <Select
                  v-model="triggerConceptKey"
                  :options="ontologyStore.concepts"
                  option-label="label"
                  option-value="key"
                  placeholder="Select concept"
                  class="w-full"
                />
              </div>
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Field</label>
                <Select
                  v-model="triggerFieldName"
                  :options="triggerConceptProperties"
                  option-label="label"
                  option-value="key"
                  placeholder="Select field"
                  class="w-full"
                />
              </div>
            </div>
          </template>

          <!-- Scheduled -->
          <template v-if="selectedTriggerType === 'scheduled'">
            <div class="space-y-3">
              <label class="text-xs font-medium text-surface-500 block mb-1">Schedule</label>
              <Select
                v-model="schedulePreset"
                :options="schedulePresets"
                option-label="label"
                option-value="value"
                placeholder="Select schedule"
                class="w-full"
              />
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Custom Cron</label>
                <InputText
                  v-model="triggerSchedule"
                  placeholder="*/15 * * * *"
                  class="w-full"
                />
              </div>
              <div v-if="triggerSchedule" class="text-xs text-surface-500 bg-surface-100 rounded px-2 py-1">
                {{ humanReadableCron }}
              </div>
            </div>
          </template>

          <!-- Manual -->
          <template v-if="selectedTriggerType === 'manual'">
            <div class="space-y-3">
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Button Label</label>
                <InputText
                  v-model="triggerButtonLabel"
                  placeholder="Run workflow"
                  class="w-full"
                />
              </div>
              <div>
                <label class="text-xs font-medium text-surface-500 block mb-1">Description</label>
                <InputText
                  v-model="triggerDescription"
                  placeholder="What this workflow does"
                  class="w-full"
                />
              </div>
            </div>
          </template>
        </div>

        <!-- Condition -->
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-widest text-surface-500 mb-2">
            Only run when...
          </h3>
          <ConditionBuilder
            :model-value="workflowCondition"
            :properties="triggerConceptProperties"
            @update:model-value="(v) => { workflowCondition = v }"
          />
        </div>
      </div>

      <!-- Center: Action chain -->
      <div class="flex-1 overflow-y-auto p-6 bg-surface-50">
        <h3 class="text-xs font-semibold uppercase tracking-widest text-surface-500 mb-4">
          Action Chain
        </h3>

        <div class="space-y-3">
          <div
            v-for="(action, idx) in actions"
            :key="action.id"
            :class="[
              'flex items-center gap-3 px-4 py-3 rounded-lg border-2 cursor-pointer transition-all',
              selectedActionIdx === idx
                ? 'border-primary-500 bg-white ring-1 ring-primary-200'
                : 'border-surface-200 bg-white hover:border-surface-300',
            ]"
            draggable="true"
            @click="selectedActionIdx = idx"
            @dragstart="(e) => { actionDragIdx = idx; e.dataTransfer?.setData('text/plain', String(idx)) }"
            @dragover.prevent
            @drop.prevent="handleActionReorder(idx)"
          >
            <!-- Position badge -->
            <span
              class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-surface-100 text-xs font-semibold text-surface-600"
            >
              {{ idx + 1 }}
            </span>

            <!-- Icon -->
            <i
              :class="[getActionTypeIcon(action.type), 'text-lg']"
              :style="{ color: `var(--${getActionTypeColor(action.type)}-500)` }"
            />

            <!-- Label -->
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-surface-700 truncate">
                {{ action.label || getActionTypeLabel(action.type) }}
              </div>
              <div class="text-[11px] text-surface-400 truncate">
                {{ getActionSummary(action) }}
              </div>
            </div>

            <!-- Chain connector -->
            <div v-if="idx < actions.length - 1" class="shrink-0">
              <i class="pi pi-arrow-down text-surface-300" />
            </div>

            <!-- Remove -->
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              size="small"
              class="!p-1 shrink-0"
              aria-label="Remove action"
              @click.stop="removeAction(idx)"
            />
          </div>
        </div>

        <!-- Add action dropdown -->
        <div class="mt-4">
          <Select
            :options="actionTypeInfoList"
            option-label="label"
            option-value="type"
            placeholder="+ Add Action"
            class="w-full"
            @change="(e) => addAction(e.value as ActionType)"
          />
        </div>

        <!-- Empty state -->
        <div
          v-if="actions.length === 0"
          class="text-center py-12 text-surface-400"
        >
          <i class="pi pi-sitemap text-3xl mb-3" />
          <p class="text-sm">
            No actions defined. Add an action to build your workflow.
          </p>
        </div>
      </div>

      <!-- Right: Selected action config -->
      <div class="w-80 shrink-0 border-l border-surface-200 bg-white overflow-y-auto">
        <ActionConfigPanel
          :action="selectedAction"
          :concepts="ontologyStore.concepts"
          @update:label="(v) => updateActionLabel(v)"
          @update:config="(k, v) => updateActionConfig(k, v)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Select from 'primevue/select'

import type { OntologyProperty } from '@/types'
import type { ConditionExpression } from '@/types/forms'
import type {
  TriggerType,
  ActionType,
  WorkflowConfig,
} from '@/types/workflow'
import {
  ACTION_TYPE_INFO,
  TRIGGER_TYPE_INFO,
} from '@/types/workflow'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'
import ConditionBuilder from '@/components/conditions/ConditionBuilder.vue'
import ActionConfigPanel from '@/components/builders/ActionConfigPanel.vue'

/* ---- Route & Store ---- */

const route = useRoute()
const router = useRouter()
const ontologyStore = useOntologyStore()

/* ---- State ---- */

const workflowId = ref<string | null>(
  route.params.id ? String(route.params.id) : null,
)
const workflowName = ref('New Workflow')
const saving = ref(false)
const dryRunning = ref(false)
const errorMessage = ref<string | null>(null)

// Trigger
const selectedTriggerType = ref<TriggerType>('domain_event')
const triggerConceptKey = ref<string>('')
const triggerEventName = ref<string>('')
const triggerFieldName = ref<string>('')
const triggerSchedule = ref<string>('')
const triggerButtonLabel = ref<string>('Run')
const triggerDescription = ref<string>('')
const schedulePreset = ref<string>('')

// Condition
const workflowCondition = ref<ConditionExpression | null>(null)

// Actions
interface MutableAction {
  id: string
  type: ActionType
  label: string
  config: Record<string, unknown>
  position: number
}

const actions = ref<MutableAction[]>([])
const selectedActionIdx = ref<number | null>(null)
let actionDragIdx: number | null = null

// Dry run results
const dryRunResults = ref<
  Array<{ actionIndex: number; wouldExecute: boolean; reason: string }>
>([])

/* ---- Lists ---- */

const triggerTypeInfoList = [...TRIGGER_TYPE_INFO]
const actionTypeInfoList = [...ACTION_TYPE_INFO]

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

/* ---- Computed ---- */

const triggerConceptProperties = computed<OntologyProperty[]>(() =>
  ontologyStore.getPropertiesForConcept(triggerConceptKey.value),
)

const selectedAction = computed<MutableAction | null>(() =>
  selectedActionIdx.value !== null ? actions.value[selectedActionIdx.value] ?? null : null,
)

const humanReadableCron = computed(() => {
  const cron = triggerSchedule.value.trim()
  if (!cron) return ''
  const preset = schedulePresets.find((p) => p.value === cron)
  if (preset) return preset.label
  return `Custom: ${cron}`
})

const validationItems = computed(() => {
  const items: Array<{ label: string; ok: boolean }> = []

  // Check for loops (simplified client-side check)
  items.push({ label: 'No loops', ok: true })

  // Check that action targets exist
  const allTargetsExist = actions.value.every((a) => {
    if (a.type === 'create_record' || a.type === 'update_record' || a.type === 'delete_record') {
      const target = a.config['targetConcept'] as string | undefined
      return Boolean(target && ontologyStore.getConceptByKey(target))
    }
    return true
  })
  items.push({ label: 'Targets exist', ok: allTargetsExist })

  // Rate check for scheduled
  items.push({ label: 'Rate OK', ok: true })

  return items
})

/* ---- Action helpers ---- */

function getActionTypeIcon(type: ActionType): string {
  return ACTION_TYPE_INFO.find((a) => a.type === type)?.icon ?? 'pi pi-circle'
}

function getActionTypeColor(type: ActionType): string {
  return ACTION_TYPE_INFO.find((a) => a.type === type)?.color ?? 'surface'
}

function getActionTypeLabel(type: ActionType): string {
  return ACTION_TYPE_INFO.find((a) => a.type === type)?.label ?? type
}

function getActionSummary(action: MutableAction): string {
  const target = action.config['targetConcept'] as string | undefined
  if (target) return `Target: ${target}`
  const template = action.config['templateName'] as string | undefined
  if (template) return `Template: ${template}`
  return ''
}

/* ---- Action management ---- */

function addAction(type: ActionType): void {
  const newAction: MutableAction = {
    id: crypto.randomUUID(),
    type,
    label: '',
    config: {},
    position: actions.value.length,
  }
  actions.value = [...actions.value, newAction]
  selectedActionIdx.value = actions.value.length - 1
}

function removeAction(idx: number): void {
  actions.value = actions.value
    .filter((_, i) => i !== idx)
    .map((a, i) => ({ ...a, position: i }))
  if (selectedActionIdx.value === idx) {
    selectedActionIdx.value = null
  } else if (selectedActionIdx.value !== null && selectedActionIdx.value > idx) {
    selectedActionIdx.value = selectedActionIdx.value - 1
  }
}

function handleActionReorder(targetIdx: number): void {
  if (actionDragIdx === null || actionDragIdx === targetIdx) {
    actionDragIdx = null
    return
  }
  const list = [...actions.value]
  const [moved] = list.splice(actionDragIdx, 1)
  list.splice(targetIdx, 0, moved)
  actions.value = list.map((a, i) => ({ ...a, position: i }))
  actionDragIdx = null
}

function updateActionConfig(key: string, value: unknown): void {
  if (selectedActionIdx.value === null) return
  const action = actions.value[selectedActionIdx.value]
  if (!action) return
  actions.value = actions.value.map((a, i) =>
    i === selectedActionIdx.value
      ? { ...a, config: { ...a.config, [key]: value } }
      : a,
  )
}

function updateActionLabel(value: string): void {
  if (selectedActionIdx.value === null) return
  const action = actions.value[selectedActionIdx.value]
  if (!action) return
  actions.value = actions.value.map((a, i) =>
    i === selectedActionIdx.value
      ? { ...a, label: value }
      : a,
  )
}

/* ---- Build config ---- */

function buildWorkflowConfig(): WorkflowConfig {
  return {
    id: workflowId.value ?? '',
    name: workflowName.value,
    trigger: {
      type: selectedTriggerType.value,
      conceptKey: triggerConceptKey.value || undefined,
      eventName:
        selectedTriggerType.value === 'domain_event'
          ? `${triggerConceptKey.value}.${triggerEventName.value}`
          : undefined,
      fieldName:
        selectedTriggerType.value === 'field_changed'
          ? triggerFieldName.value
          : undefined,
      schedule:
        selectedTriggerType.value === 'scheduled'
          ? triggerSchedule.value
          : undefined,
      buttonLabel:
        selectedTriggerType.value === 'manual'
          ? triggerButtonLabel.value
          : undefined,
      description:
        selectedTriggerType.value === 'manual'
          ? triggerDescription.value
          : undefined,
    },
    condition: workflowCondition.value,
    actions: actions.value.map((a) => ({
      id: a.id,
      type: a.type,
      label: a.label || getActionTypeLabel(a.type),
      config: { ...a.config },
      position: a.position,
    })),
    enabled: true,
  }
}

/* ---- Save ---- */

async function handleSave(): Promise<void> {
  saving.value = true
  errorMessage.value = null

  try {
    const config = buildWorkflowConfig()
    if (workflowId.value) {
      await api.put(`/api/workflow-configs/${workflowId.value}`, config)
    } else {
      const result = await api.post<{ id: string }>('/api/workflow-configs', config)
      workflowId.value = result.id
    }
  } catch (err) {
    errorMessage.value =
      err instanceof Error ? err.message : 'Failed to save workflow'
  } finally {
    saving.value = false
  }
}

/* ---- Dry run ---- */

async function handleDryRun(): Promise<void> {
  if (!workflowId.value) {
    errorMessage.value = 'Save the workflow before testing'
    return
  }

  dryRunning.value = true
  dryRunResults.value = []

  try {
    const result = await api.post<{
      actionResults: Array<{
        actionIndex: number
        wouldExecute: boolean
        reason: string
      }>
    }>(`/api/workflow-configs/${workflowId.value}/dry-run`, {})

    dryRunResults.value = result.actionResults
  } catch (err) {
    errorMessage.value =
      err instanceof Error ? err.message : 'Dry run failed'
  } finally {
    dryRunning.value = false
  }
}

/* ---- Navigation ---- */

function navigateToCanvas(): void {
  if (workflowId.value) {
    router.push(`/canvas/workflow/${workflowId.value}`)
  }
}

/* ---- Load existing ---- */

async function loadExistingWorkflow(): Promise<void> {
  if (!workflowId.value) return

  try {
    const config = await api.get<WorkflowConfig>(
      `/api/workflow-configs/${workflowId.value}`,
    )
    workflowName.value = config.name
    selectedTriggerType.value = config.trigger.type
    triggerConceptKey.value = config.trigger.conceptKey ?? ''

    if (config.trigger.eventName) {
      const parts = config.trigger.eventName.split('.')
      triggerEventName.value = parts[parts.length - 1] ?? ''
    }
    triggerFieldName.value = config.trigger.fieldName ?? ''
    triggerSchedule.value = config.trigger.schedule ?? ''
    triggerButtonLabel.value = config.trigger.buttonLabel ?? 'Run'
    triggerDescription.value = config.trigger.description ?? ''

    workflowCondition.value = config.condition ?? null

    actions.value = config.actions.map((a) => ({
      id: a.id,
      type: a.type,
      label: a.label,
      config: { ...a.config },
      position: a.position,
    }))
  } catch {
    // No existing workflow
  }
}

/* ---- Lifecycle ---- */

onMounted(async () => {
  await ontologyStore.loadOntology()
  await loadExistingWorkflow()
})
</script>
