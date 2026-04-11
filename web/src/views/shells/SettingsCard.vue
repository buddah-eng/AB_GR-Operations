<template>
  <div
    :class="[
      'rounded-lg border border-surface-200 bg-surface-0 p-5 transition-shadow',
      editRoute ? 'hover:shadow-md' : 'opacity-60',
    ]"
  >
    <div class="flex items-start gap-4">
      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
        <i :class="icon" />
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="font-medium text-surface-900">{{ title }}</h3>
        <p class="text-sm text-surface-500 mt-1">{{ description }}</p>
      </div>
      <router-link
        v-if="editRoute"
        :to="editRoute"
        class="text-sm text-primary-600 hover:text-primary-700 font-medium"
      >
        Edit
      </router-link>
      <span
        v-else
        class="text-xs text-surface-400 bg-surface-100 px-2 py-1 rounded-full font-medium whitespace-nowrap"
      >
        Coming Soon
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

defineProps<{
  title: string
  description: string
  icon: string
  editRoute?: RouteLocationRaw
}>()
</script>
