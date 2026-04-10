<template>
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
        @click="emit('clearDryRun')"
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
</template>

<script setup lang="ts">
import Button from 'primevue/button'

export interface ValidationItem {
  label: string
  ok: boolean
}

export interface DryRunResult {
  actionIndex: number
  wouldExecute: boolean
  reason: string
}

defineProps<{
  validationItems: ValidationItem[]
  dryRunResults: DryRunResult[]
}>()

const emit = defineEmits<{
  clearDryRun: []
}>()
</script>

<style scoped>
.wf-validation-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-5);
  border-bottom: var(--border-thin) solid var(--border-color);
  background: var(--surface-50);
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

.wf-dry-run-panel {
  flex-shrink: 0;
  margin: var(--space-2) var(--space-5) 0;
  padding: var(--space-4);
  background: var(--color-info-bg);
  border: var(--border-thin) solid var(--color-info-bg-border);
  border-radius: var(--radius-lg);
}

.wf-dry-run-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.wf-dry-run-panel__title {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-info-text);
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
  font-size: var(--text-sm);
}

.wf-dry-run-result--active {
  color: var(--color-success-text-dark);
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
</style>
