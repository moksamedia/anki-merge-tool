<script setup>
import { ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { useMergeSession } from '../composables/useMergeSession.js'

// Renders field HTML sanitized, with images loaded from the package or the
// library media folder (source: 'pkg' | 'lib' | 'result' = package then library).
const props = defineProps({
  html: { type: String, default: '' },
  source: { type: String, required: true },
})

const { resolveMedia } = useMergeSession()
const rendered = ref('')
let latest = 0

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

watch(
  () => [props.html, props.source],
  async () => {
    const run = ++latest
    const withSounds = (props.html ?? '').replace(
      /\[sound:([^\]]+)\]/g,
      (_, name) => `<span class="sound">🔊 ${escapeHtml(name)}</span>`,
    )
    const doc = new DOMParser().parseFromString(DOMPurify.sanitize(withSounds), 'text/html')
    await Promise.all(
      [...doc.querySelectorAll('img')].map(async (img) => {
        const src = img.getAttribute('src') ?? ''
        if (/^(https?|data):/i.test(src)) return
        let name = src
        try {
          name = decodeURI(src)
        } catch {
          // keep the raw value
        }
        const url = await resolveMedia(name, props.source)
        if (url) img.setAttribute('src', url)
        else img.replaceWith(Object.assign(doc.createElement('span'), { className: 'missing', textContent: `missing image: ${name}` }))
      }),
    )
    if (run === latest) rendered.value = doc.body.innerHTML
  },
  { immediate: true },
)
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- sanitized by DOMPurify above -->
  <div class="preview" v-html="rendered || '<span class=&quot;empty&quot;>(empty)</span>'"></div>
</template>
