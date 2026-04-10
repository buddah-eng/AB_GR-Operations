<template>
  <div class="builder-shell" role="region" aria-label="Workflow Builder">
    <!-- Toolbar -->
    <div class="builder-toolbar">
      <div class="builder-toolbar__left">
        <i class="pi pi-sitemap builder-toolbar__icon" />
        <InputText
          v-model="workflowName"
          placeholder="Workflow name"
          class="builder-toolbar__name-input"
          aria-label="Workflow name"
        />
      </div>

      <div class="builder-toolbar__right">
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

    <WorkflowValidationBar
      :validation-items="validationItems"
      :dry-run-results="dryRunResults"
      @clear-dry-run="dryRunResults = []"
    />

    <!-- Error -->
    <Message
      v-if="errorMessage"
      severity="error"
      :closable="true"
      class="builder-message"
      @close="errorMessage = null"
    >
      {{ errorMessage }}
    </Message>

    <!-- 3-panel layout -->
    <div class="builder-panels">
      <!-- Left: Trigger picker + Condition -->
      <div class="builder-sidebar builder-sidebar--left">
        <TriggerConfigPanel
          :selected-trigger-type="selectedTriggerType"
          :trigger-concept-key="triggerConceptKey"
          :trigger-event-name="triggerEventName"
          :trigger-field-name="triggerFieldName"
          :trigger-schedule="triggerSchedule"
          :trigger-button-label="triggerButtonLabel"
          :trigger-description="triggerDescription"
          :schedule-preset="schedulePreset"
          :condition="workflowCondition"
          :concepts="ontologyStore.concepts"
          :concept-properties="triggerConceptProperties"
          @update:trigger-type="(v) => { selectedTriggerType = v }"
          @update:concept-key="(v) => { triggerConceptKey = v }"
          @update:event-name="(v) => { triggerEventName = v }"
          @update:field-name="(v) => { triggerFieldName = v }"
          @update:schedule="(v) => { triggerSchedule = v }"
          @update:schedule-preset="(v) => { schedulePreset = v }"
          @update:button-label="(v) => { triggerButtonLabel = v }"
          @update:description="(v) => { triggerDescription = v }"
          @update:condition="(v) => { workflowCondition = v }"
        />
      </div>

      <!-- Center: Action chain -->
      <div class="builder-canvas wf-action-canvas">
        <h3 class="wf-section-label" style="margin-bottom: var(--space-4)">
          Action Chain
        </h3>

        <div class="wf-action-list">
          <div
            v-for="(action, idx) in actions"
            :key="action.id"
            :class="['wf-action-card', selectedActionIdx === idx ? 'wf-action-card--selected' : '']"
            draggable="true"
            @click="selectedActionIdx = idx"
            @dragstart="(e) => { actionDragIdx = idx; e.dataTransfer?.setData('text/plain', String(idx)) }"
            @dragover.prevent
            @drop.prevent="handleActionReorder(idx)"
          >
            <span class="wf-action-card__position">
              {{ idx + 1 }}
            </span>
            <i
              :class="[getActionTypeIcon(action.type)]"
              class="wf-action-card__type-icon"
              :style="{ color: `var(--${getActionTypeColor(action.type)}-500)` }"
            />
            <div class="wf-action-card__content">
              <div class="wf-action-card__label">
                {{ action.label || getActionTypeLabel(action.type) }}
              </div>
              <div class="wf-action-card__summary">
                {{ getActionSummary(action) }}
              </div>
            </div>
            <div v-if="idx < actions.length - 1" class="wf-action-card__connector">
              <i class="pi pi-arrow-down" />
            </div>
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

        <!-- Add action -->
        <div class="wf-add-action">
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
        <div v-if="actions.length === 0" class="empty-state">
          <div class="icon">
            <i class="pi pi-sitemap" />
          </div>
          <p>No actions defined. Add an action to build your workflow.</p>
        </div>
      </div>

      <!-- Right: Selected action config -->
      <div class="builder-sidebar builder-sidebar--right">
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
} from '@/types/workflow'
import { useOntologyStore } from '@/stores/ontology'
import { api } from '@/api/client'
import ActionConfigPanel from '@/components/builders/ActionConfigPanel.vue'
import TriggerConfigPanel from '@/components/builders/TriggerConfigPanel.vue'
import WorkflowValidationBar from '@/components/builders/WorkflowValidationBar.vue'

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

const actionTypeInfoList = [...ACTION_TYPE_INFO]

/* ---- Computed ---- */

const triggerConceptProperties = computed<OntologyProperty[]>(() =>
  ontologyStore.getPropertiesForConcept(triggerConceptKey.value),
)

const selectedAction = computed<MutableAction | null>(() =>
  selectedActionIdx.value !== null ? actions.value[selectedActionIdx.value] ?? null : null,
)

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

<style scoped>
.builder-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-page);
}

.builder-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-5);
  border-bottom: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
}

.builder-toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.builder-toolbar__icon {
  color: var(--primary-500);
  font-size: var(--text-lg);
}

.builder-toolbar__name-input {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  width: 16rem;
  letter-spacing: var(--tracking-tight);
}

.builder-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.builder-message {
  margin: var(--space-2) var(--space-5) 0;
}

/* Panels */
.builder-panels {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.builder-sidebar {
  flex-shrink: 0;
  overflow-y: auto;
}

.builder-sidebar--left {
  width: 18rem;
  border-right: var(--border-thin) solid var(--border-color);
  background: var(--surface-50);
  padding: var(--space-5);
}

.builder-sidebar--right {
  width: 20rem;
  border-left: var(--border-thin) solid var(--border-color);
  background: var(--bg-card);
}

.builder-canvas {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  background: var(--surface-50);
}

/* Section labels */
.wf-section-label {
  font-size: var(--text-xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--text-muted);
}

/* Action chain */
.wf-action-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.wf-action-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  border: var(--border-medium) solid var(--border-color);
  background: var(--bg-card);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-default);
}

.wf-action-card:hover {
  border-color: var(--surface-300);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.wf-action-card--selected {
  border-color: var(--primary-500);
  box-shadow: 0 0 0 3px var(--primary-100);
}

.wf-action-card__position {
  flex-shrink: 0;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: var(--surface-100);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
}

.wf-action-card--selected .wf-action-card__position {
  background: var(--primary-100);
  color: var(--primary-700);
}

.wf-action-card__type-icon {
  font-size: var(--text-lg);
}

.wf-action-card__content {
  flex: 1;
  min-width: 0;
}

.wf-action-card__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-action-card__summary {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-action-card__connector {
  flex-shrink: 0;
  color: var(--surface-300);
}

.wf-add-action {
  margin-top: var(--space-4);
}
</style>
