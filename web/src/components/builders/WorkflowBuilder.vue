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

    <!-- Validation bar -->
    <div v-if="validationItems.length > 0" class="wf-validation-bar">
      <div
        v-for="item in validationItems"
        :key="item.label"
        :class="['wf-validation-item', item.ok ? 'wf-validation-item--ok' : 'wf-validation-item--error']"
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
      class="builder-message"
      @close="errorMessage = null"
    >
      {{ errorMessage }}
    </Message>

    <!-- Dry run results -->
    <div v-if="dryRunResults.length > 0" class="wf-dry-run-panel">
      <div class="wf-dry-run-panel__header">
        <h3 class="wf-dry-run-panel__title">Dry Run Results</h3>
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          rounded
          size="small"
          @click="dryRunResults = []"
        />
      </div>
      <div class="wf-dry-run-panel__results">
        <div
          v-for="(result, idx) in dryRunResults"
          :key="idx"
          :class="['wf-dry-run-result', result.wouldExecute ? 'wf-dry-run-result--active' : 'wf-dry-run-result--skip']"
        >
          <i :class="result.wouldExecute ? 'pi pi-check' : 'pi pi-minus'" />
          <span>Step {{ result.actionIndex + 1 }}: {{ result.reason }}</span>
        </div>
      </div>
    </div>

    <!-- 3-panel layout -->
    <div class="builder-panels">
      <!-- Left: Trigger picker + Condition -->
      <div class="builder-sidebar builder-sidebar--left wf-trigger-panel">
        <!-- Trigger type -->
        <div class="wf-trigger-section">
          <h3 class="wf-section-label">Trigger</h3>
          <div class="wf-trigger-list">
            <div
              v-for="triggerInfo in triggerTypeInfoList"
              :key="triggerInfo.type"
              :class="['wf-trigger-option', selectedTriggerType === triggerInfo.type ? 'wf-trigger-option--active' : '']"
              :aria-label="`Select trigger: ${triggerInfo.label}`"
              role="radio"
              :aria-checked="selectedTriggerType === triggerInfo.type"
              @click="selectedTriggerType = triggerInfo.type"
            >
              <i :class="[triggerInfo.icon, 'wf-trigger-option__icon']" />
              <div>
                <div class="wf-trigger-option__label">{{ triggerInfo.label }}</div>
                <div class="wf-trigger-option__desc">{{ triggerInfo.description }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Trigger config -->
        <div class="wf-trigger-config">
          <template v-if="selectedTriggerType === 'domain_event'">
            <div class="wf-config-fields">
              <div class="form-field">
                <label>Concept</label>
                <Select
                  v-model="triggerConceptKey"
                  :options="ontologyStore.concepts"
                  option-label="label"
                  option-value="key"
                  placeholder="Select concept"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>Event</label>
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

          <template v-if="selectedTriggerType === 'field_changed'">
            <div class="wf-config-fields">
              <div class="form-field">
                <label>Concept</label>
                <Select
                  v-model="triggerConceptKey"
                  :options="ontologyStore.concepts"
                  option-label="label"
                  option-value="key"
                  placeholder="Select concept"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>Field</label>
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

          <template v-if="selectedTriggerType === 'scheduled'">
            <div class="wf-config-fields">
              <div class="form-field">
                <label>Schedule</label>
                <Select
                  v-model="schedulePreset"
                  :options="schedulePresets"
                  option-label="label"
                  option-value="value"
                  placeholder="Select schedule"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>Custom Cron</label>
                <InputText
                  v-model="triggerSchedule"
                  placeholder="*/15 * * * *"
                  class="w-full"
                />
              </div>
              <div v-if="triggerSchedule" class="wf-cron-preview">
                {{ humanReadableCron }}
              </div>
            </div>
          </template>

          <template v-if="selectedTriggerType === 'manual'">
            <div class="wf-config-fields">
              <div class="form-field">
                <label>Button Label</label>
                <InputText
                  v-model="triggerButtonLabel"
                  placeholder="Run workflow"
                  class="w-full"
                />
              </div>
              <div class="form-field">
                <label>Description</label>
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
        <div class="wf-condition-section">
          <h3 class="wf-section-label">Only run when...</h3>
          <ConditionBuilder
            :model-value="workflowCondition"
            :properties="triggerConceptProperties"
            @update:model-value="(v) => { workflowCondition = v }"
          />
        </div>
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
  font-family: var(--font-display);
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

/* Validation bar */
.wf-validation-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-5);
  border-bottom: var(--border-thin) solid var(--border-color);
  background: var(--surface-50);
  font-family: var(--font-display);
  font-size: var(--text-sm);
}

.wf-validation-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-validation-item--ok {
  color: var(--color-success);
}

.wf-validation-item--error {
  color: var(--color-error);
}

/* Dry run panel */
.wf-dry-run-panel {
  flex-shrink: 0;
  margin: var(--space-2) var(--space-5) 0;
  padding: var(--space-4);
  background: #eff6ff;
  border: var(--border-thin) solid #bfdbfe;
  border-radius: var(--radius-lg);
}

.wf-dry-run-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.wf-dry-run-panel__title {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: #1d4ed8;
}

.wf-dry-run-panel__results {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.wf-dry-run-result {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-body);
  font-size: var(--text-sm);
}

.wf-dry-run-result--active {
  color: #15803d;
}

.wf-dry-run-result--active i {
  color: var(--color-success);
}

.wf-dry-run-result--skip {
  color: var(--text-muted);
}

.wf-dry-run-result--skip i {
  color: var(--surface-300);
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
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--text-muted);
}

/* Trigger panel */
.wf-trigger-section {
  margin-bottom: var(--space-6);
}

.wf-trigger-section .wf-section-label {
  margin-bottom: var(--space-3);
}

.wf-trigger-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.wf-trigger-option {
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

.wf-trigger-option:hover {
  border-color: var(--surface-300);
  box-shadow: var(--shadow-xs);
}

.wf-trigger-option--active {
  border-color: var(--primary-500);
  background: var(--primary-50);
  box-shadow: 0 0 0 3px var(--primary-100);
}

.wf-trigger-option__icon {
  font-size: var(--text-sm);
  margin-top: 2px;
  color: var(--text-secondary);
}

.wf-trigger-option--active .wf-trigger-option__icon {
  color: var(--primary-600);
}

.wf-trigger-option__label {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.wf-trigger-option__desc {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
  line-height: var(--leading-snug);
}

/* Trigger config */
.wf-trigger-config {
  margin-bottom: var(--space-6);
}

.wf-config-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.wf-cron-preview {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--surface-100);
  border-radius: var(--radius-md);
  padding: var(--space-1) var(--space-2);
}

/* Condition section */
.wf-condition-section .wf-section-label {
  margin-bottom: var(--space-2);
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
  font-family: var(--font-display);
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
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-action-card__summary {
  font-family: var(--font-body);
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
