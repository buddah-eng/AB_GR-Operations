<template>
  <div
    class="department-region"
    :style="{
      '--region-color': data.color,
      borderColor: data.color + '40',
      backgroundColor: data.color + '06',
    }"
  >
    <!-- Region label -->
    <div class="department-region__header">
      <span class="department-region__dot" />
      <span class="department-region__label">
        {{ data.label }}
      </span>
      <span class="department-region__count">
        {{ data.nodeIds.length }} {{ data.nodeIds.length === 1 ? 'node' : 'nodes' }}
      </span>
    </div>

    <!-- No handles needed for region nodes (they are grouping containers) -->
  </div>
</template>

<script setup lang="ts">
import type { DepartmentRegionData } from '@/types/canvas'

defineProps<{
  data: DepartmentRegionData
}>()
</script>

<style scoped>
.department-region {
  border-radius: var(--radius-xl);
  border: var(--border-medium) dashed;
  padding: var(--space-5);
  min-width: 300px;
  min-height: 220px;
  transition: all var(--duration-normal) var(--ease-default);
}

.department-region:hover {
  border-color: var(--region-color, var(--primary-400)) !important;
  background-color: color-mix(in srgb, var(--region-color, var(--primary-400)) 8%, transparent) !important;
}

.department-region__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.department-region__dot {
  width: 12px;
  height: 12px;
  border-radius: var(--radius-full);
  background: var(--region-color, var(--primary-400));
  flex-shrink: 0;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--region-color, var(--primary-400)) 20%, transparent);
}

.department-region__label {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  font-weight: var(--weight-extrabold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--region-color, var(--primary-600));
}

.department-region__count {
  font-size: 10px;
  color: var(--text-muted);
  margin-left: auto;
  letter-spacing: var(--tracking-wide);
}
</style>
