<template>
  <div
    :class="['concept-node', 'canvas-node', selected ? 'selected' : '']"
    :style="nodeStyle"
  >
    <!-- Accent left bar -->
    <div class="concept-node__accent" />

    <!-- Header row -->
    <div class="concept-node__header">
      <div class="concept-node__icon-wrapper">
        <i
          :class="[data.icon || 'pi pi-circle']"
          class="concept-node__icon"
        />
      </div>
      <span class="concept-node__label">
        {{ data.label }}
      </span>
    </div>

    <!-- Record count badge -->
    <div
      v-if="data.propertyCount > 0"
      class="concept-node__badge-row"
    >
      <i class="pi pi-database concept-node__badge-icon" />
      <span class="concept-node__badge">
        {{ data.propertyCount }} {{ data.propertyCount === 1 ? 'record' : 'records' }}
      </span>
    </div>

    <!-- Connection handles -->
    <Handle type="target" :position="Position.Left" class="concept-node__handle" />
    <Handle type="source" :position="Position.Right" class="concept-node__handle" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, useNode } from '@vue-flow/core'
import type { ConceptNodeData } from '@/types/canvas'

const props = defineProps<{
  data: ConceptNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)

const nodeStyle = computed(() => ({
  '--node-accent': props.data.departmentColor,
  '--node-accent-light': `${props.data.departmentColor}14`,
  '--node-accent-gradient': `${props.data.departmentColor}0a`,
}))
</script>

<style scoped>
.concept-node {
  position: relative;
  background:
    linear-gradient(
      135deg,
      var(--node-accent-light, rgba(100, 116, 139, 0.08)) 0%,
      var(--node-accent-gradient, rgba(100, 116, 139, 0.04)) 40%,
      var(--bg-card) 100%
    );
  min-width: 210px;
  padding: var(--space-4) var(--space-5);
  padding-left: calc(var(--space-5) + 4px);
  border-radius: 12px;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  transition:
    box-shadow var(--duration-normal) var(--ease-default),
    transform var(--duration-normal) var(--ease-default);
}

.concept-node:hover {
  box-shadow:
    0 10px 25px rgba(0, 0, 0, 0.08),
    0 4px 10px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

.concept-node__accent {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 4px;
  background: var(--node-accent, var(--primary-400));
  border-radius: 12px 0 0 12px;
  transition: width var(--duration-fast) var(--ease-default);
}

.concept-node:hover .concept-node__accent {
  width: 6px;
}

.concept-node__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}

.concept-node__icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--node-accent-light, rgba(100, 116, 139, 0.1));
  flex-shrink: 0;
}

.concept-node__icon {
  font-size: var(--text-sm);
  color: var(--node-accent, var(--primary-400));
}

.concept-node__label {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: var(--tracking-tight);
  line-height: 1.3;
}

.concept-node__badge-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.concept-node__badge-icon {
  font-size: 9px;
  color: var(--text-muted);
  opacity: 0.7;
}

.concept-node__badge {
  font-family: var(--font-display);
  font-size: 10px;
  font-weight: var(--weight-medium);
  color: var(--text-muted);
  background: var(--surface-100);
  border-radius: var(--radius-full);
  padding: 2px var(--space-2);
  letter-spacing: var(--tracking-wide);
}

.concept-node__handle {
  width: 8px !important;
  height: 8px !important;
  background: var(--surface-400) !important;
  border: var(--border-thin) solid var(--bg-card) !important;
  transition: all var(--duration-fast) var(--ease-default);
}

.concept-node:hover .concept-node__handle {
  background: var(--node-accent, var(--primary-400)) !important;
  transform: scale(1.2);
}
</style>
