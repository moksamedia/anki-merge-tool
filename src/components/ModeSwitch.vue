<script setup>
// Two icon buttons: <> for raw HTML (code) and a pen for the field editor.
defineProps({
  modelValue: { type: String, required: true },
  label: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <span class="mode-switch" role="group" :aria-label="label">
    <button type="button" :class="{ on: modelValue === 'code' }" title="Code (raw HTML)" aria-label="Code" @click="emit('update:modelValue', 'code')">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M5.5 3.5 1.5 8l4 4.5M10.5 3.5 14.5 8l-4 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <button type="button" :class="{ on: modelValue === 'editor' }" title="Editor (like Anki's field editor)" aria-label="Editor" @click="emit('update:modelValue', 'editor')">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="m11.2 2.3 2.5 2.5-7.9 7.9-3.3.8.8-3.3zM9.6 3.9l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </span>
</template>
