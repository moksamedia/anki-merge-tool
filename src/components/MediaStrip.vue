<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { mediaReferences } from '../lib/match.js'
import { mediaKind } from '../lib/display.js'

// Thumbnails and players for the media a field references, shown under its raw
// HTML so images and sounds can be checked without switching to rendered view.
// source: 'pkg' | 'lib' | 'result' (package, then library), as in FieldPreview.
// lazy: fetch the media only once the strip scrolls near view, for long lists.
const props = defineProps({
  html: { type: String, default: '' },
  source: { type: String, required: true },
  lazy: { type: Boolean, default: false },
})

const { resolveMedia } = useMergeSession()
const items = ref([])
const root = ref(null)
const visible = ref(!props.lazy)
let latest = 0
let observer = null

onMounted(() => {
  if (!props.lazy) return
  observer = new IntersectionObserver(
    (seen) => {
      if (!seen.some((e) => e.isIntersecting)) return
      visible.value = true
      observer.disconnect()
    },
    { rootMargin: '300px' },
  )
  observer.observe(root.value)
})
onUnmounted(() => observer?.disconnect())

watch(
  () => [props.html, props.source, visible.value],
  async () => {
    if (!visible.value) return
    const run = ++latest
    const refs = mediaReferences(props.html).map((name) => ({ name, kind: mediaKind(name) })).filter((m) => m.kind)
    const resolved = await Promise.all(refs.map(async (m) => ({ ...m, url: await resolveMedia(m.name, props.source) })))
    if (run === latest) items.value = resolved
  },
  { immediate: true },
)
</script>

<template>
  <div ref="root">
    <div v-if="items.length" class="media-strip">
      <figure v-for="m in items" :key="m.name" :title="m.name">
        <template v-if="m.url">
          <img v-if="m.kind === 'image'" :src="m.url" :alt="m.name" />
          <audio v-else :src="m.url" controls preload="metadata"></audio>
        </template>
        <span v-else class="missing">missing {{ m.kind }}</span>
        <figcaption>{{ m.name }}</figcaption>
      </figure>
    </div>
  </div>
</template>
