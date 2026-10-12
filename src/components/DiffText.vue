<script setup>
import { computed } from 'vue'
import { diffWordsWithSpace } from 'diff'

// Raw-HTML word diff of library (a) vs package (b). The library side marks what
// the package removes; the package side marks what it adds.
const props = defineProps({
  a: { type: String, default: '' },
  b: { type: String, default: '' },
  side: { type: String, required: true },
})

const parts = computed(() =>
  diffWordsWithSpace(props.a ?? '', props.b ?? '').filter((p) => (props.side === 'lib' ? !p.added : !p.removed)),
)
</script>

<template>
  <div class="raw">
    <span v-for="(p, i) in parts" :key="i" :class="{ del: p.removed, ins: p.added }">{{ p.value }}</span>
    <span v-if="!(side === 'lib' ? a : b)" class="empty">(empty)</span>
  </div>
</template>
