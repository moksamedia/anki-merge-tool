<script setup>
import { onMounted, ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { editorHtml, escapeHtml, prepareFieldHtml } from '../lib/fieldHtml.js'

// An editable field like Anki's own: the field's HTML shown with the note
// type's field font, images inline, [sound:] as text, Enter inserting <br>.
// v-model is the raw field HTML.
const props = defineProps({
  modelValue: { type: String, default: '' },
  font: { type: Object, default: () => ({ font: 'Arial', size: 20 }) },
  source: { type: String, default: 'result' },
})
const emit = defineEmits(['update:modelValue'])

const { resolveMedia } = useMergeSession()
const root = ref(null)
let lastEmitted = null
let latest = 0

async function load() {
  const run = ++latest
  const html = await prepareFieldHtml(props.modelValue, props.source, resolveMedia, { sounds: 'text', missing: 'keep' })
  if (run === latest && root.value) root.value.innerHTML = html
}

onMounted(load)
// Changes from outside (a side checkbox, Reset) reload; our own edits don't.
watch(
  () => props.modelValue,
  (value) => {
    if (value !== lastEmitted) load()
  },
)

function onInput() {
  lastEmitted = editorHtml(root.value)
  emit('update:modelValue', lastEmitted)
}

// Enter inserts a <br>, as Anki does. The browser's own line break would be a
// newline character here (white-space: pre-wrap). A <br> at the very end of
// the content doesn't show as a new line, so a second, sentinel <br> follows
// it; editorHtml() leaves the sentinel out of the value.
function onKeydown(e) {
  if (e.key !== 'Enter' || e.isComposing) return
  e.preventDefault()
  const sel = window.getSelection()
  if (!sel?.rangeCount || !root.value.contains(sel.anchorNode)) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const br = document.createElement('br')
  range.insertNode(br)
  if (!br.nextSibling) br.after(document.createElement('br'))
  if (br.nextSibling.nodeName === 'BR' && !br.nextSibling.nextSibling) br.nextSibling.dataset.sentinel = ''
  range.setStartAfter(br)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  onInput()
}

// Pasted content comes in as text, with its line breaks as <br>, so foreign markup can't slip in.
function onPaste(e) {
  e.preventDefault()
  const text = e.clipboardData.getData('text/plain')
  document.execCommand('insertHTML', false, escapeHtml(text).replace(/\r?\n/g, '<br>'))
}
</script>

<template>
  <div
    ref="root"
    class="html-editor"
    contenteditable="true"
    spellcheck="false"
    :style="{ fontFamily: font.font, fontSize: `${font.size}px` }"
    @input="onInput"
    @keydown="onKeydown"
    @paste="onPaste"
  ></div>
</template>
