<script setup>
import { ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { prepareFieldHtml } from '../lib/fieldHtml.js'

// Renders field HTML sanitized, with images loaded from the package or the
// library media folder (source: 'pkg' | 'lib' | 'result' = package then library).
const props = defineProps({
  html: { type: String, default: '' },
  source: { type: String, required: true },
})

const { resolveMedia } = useMergeSession()
const rendered = ref('')
let latest = 0

watch(
  () => [props.html, props.source],
  async () => {
    const run = ++latest
    const html = await prepareFieldHtml(props.html, props.source, resolveMedia)
    if (run === latest) rendered.value = html
  },
  { immediate: true },
)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- sanitized by DOMPurify in prepareFieldHtml -->
  <div class="preview" v-html="rendered || '<span class=&quot;empty&quot;>(empty)</span>'"></div>
</template>
