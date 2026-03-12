<template>
  <div class="space-y-5 pt-4">
    <Card>
      <template #title>
        <span class="font-display">Add {{ itemLabel }}</span>
      </template>
      <template #content>
        <div class="flex items-end gap-3">
          <div class="flex flex-col gap-2 flex-1 max-w-sm">
            <label class="text-sm font-medium text-surface-700">
              {{ fieldHeader }}
            </label>
            <InputText
              v-model="newItemName"
              :placeholder="placeholder"
              @keydown.enter="addItem"
            />
          </div>
          <Button label="Add" icon="pi pi-plus" @click="addItem" />
        </div>
      </template>
    </Card>

    <DataTable :value="items" stripedRows tableStyle="min-width: 30rem">
      <template #empty>
        <div class="text-center py-8 text-surface-400">
          No {{ itemLabel.toLowerCase() }}s configured
        </div>
      </template>
      <Column :field="fieldKey" :header="fieldHeader" sortable />
      <Column header="Actions" style="width: 8rem" :exportable="false">
        <template #body="{ index }">
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            rounded
            :aria-label="`Delete ${itemLabel.toLowerCase()}`"
            @click="confirmDelete($event, index)"
          />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Card from 'primevue/card'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

interface Props {
  items: Record<string, unknown>[]
  fieldKey: string
  fieldHeader: string
  itemLabel: string
  placeholder?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  add: [name: string]
  delete: [index: number]
}>()

const toast = useToast()
const confirm = useConfirm()
const newItemName = ref('')

function addItem(): void {
  const name = newItemName.value.trim()
  if (!name) {
    toast.add({
      severity: 'warn',
      summary: 'Validation',
      detail: `${props.itemLabel} name is required`,
      life: 3000,
    })
    return
  }

  const exists = props.items.some(
    (item) =>
      String(item[props.fieldKey]).toLowerCase() === name.toLowerCase(),
  )
  if (exists) {
    toast.add({
      severity: 'warn',
      summary: 'Duplicate',
      detail: `This ${props.itemLabel.toLowerCase()} already exists`,
      life: 3000,
    })
    return
  }

  emit('add', name)
  newItemName.value = ''
}

function confirmDelete(event: Event, index: number): void {
  const name = String(props.items[index]?.[props.fieldKey] ?? '')
  confirm.require({
    target: event.currentTarget as HTMLElement,
    message: `Delete ${props.itemLabel.toLowerCase()} "${name}"?`,
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: () => emit('delete', index),
  })
}
</script>
