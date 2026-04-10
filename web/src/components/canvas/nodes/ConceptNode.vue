<template>
  <div
    :class="['concept-node', 'canvas-node', selected ? 'selected' : '']"
    :style="{ '--node-accent': data.departmentColor }"
  >
    <!-- Accent left bar -->
    <div class="concept-node__accent" />

    <!-- Header row -->
    <div class="concept-node__header">
      <i
        :class="[data.icon || 'pi pi-circle']"
        class="concept-node__icon"
      />
      <span class="concept-node__label">
        {{ data.label }}
      </span>
    </div>

    <!-- Property count badge -->
    <div
      v-if="data.propertyCount > 0"
      class="concept-node__badge-row"
    >
      <span class="concept-node__badge">
        {{ data.propertyCount }} {{ data.propertyCount === 1 ? 'property' : 'properties' }}
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

defineProps<{
  data: ConceptNodeData
}>()

const { node } = useNode()
const selected = computed(() => node.selected)
</script>

<style scoped>
.concept-node {
  position: relative;
  background: var(--bg-card);
  min-width: 180px;
  padding: var(--space-3) var(--space-4);
  padding-left: calc(var(--space-4) + 4px);
  cursor: pointer;
  overflow: hidden;
}

.concept-node__accent {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 4px;
  background: var(--node-accent, var(--primary-400));
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  transition: width var(--duration-fast) var(--ease-default);
}

.concept-node:hover .concept-node__accent {
  width: 6px;
}

.concept-node__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.concept-node__icon {
  font-size: var(--text-sm);
  color: var(--node-accent, var(--primary-400));
  flex-shrink: 0;
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
}

.concept-node__badge-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-1);
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
