<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useMergeSession } from '../composables/useMergeSession.js'
import { initialResolution } from '../lib/match.js'
import { entryLabel, STATUS_LABEL } from '../lib/display.js'
import { isManualEdit, takenSides, valueForSides } from '../lib/resultSides.js'
import DiffText from './DiffText.vue'
import FieldPreview from './FieldPreview.vue'
import MediaStrip from './MediaStrip.vue'
import HtmlEditor from './HtmlEditor.vue'
import ModeSwitch from './ModeSwitch.vue'

const props = defineProps({
  entry: { type: Object, required: true },
  index: { type: Number, required: true },
  total: { type: Number, required: true },
})
const emit = defineEmits(['prev', 'next'])

const { state, settings, fieldFont } = useMergeSession()
const rendered = ref(false)
const showSame = ref(false)

const resolution = computed(() => state.resolutions[props.entry.guid])
const shownFields = computed(() => props.entry.fields.filter((f) => showSame.value || f.status !== 'same'))
const sameCount = computed(() => props.entry.fields.filter((f) => f.status === 'same').length)

// Result cells: 'code' (raw HTML textarea) or 'editor' (Anki-like field).
// The header sets every cell; a cell can then differ until the next header click.
const cellModes = reactive({})
const modeOf = (f) => cellModes[f.name] ?? settings.resultMode
function setAllModes(mode) {
  settings.resultMode = mode
  for (const name of Object.keys(cellModes)) delete cellModes[name]
}
const toggleCell = (f) => (cellModes[f.name] = modeOf(f) === 'code' ? 'editor' : 'code')
const fontFor = (f) => fieldFont(props.entry.libNote.modelName, f.name)

// Ctrl/Cmd+Shift+X toggles the HTML editor for that field, as in Anki.
function onCellKey(f, e) {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault()
    toggleCell(f)
  }
}

const rows = (text) => Math.min(12, Math.max(2, Math.ceil((text?.length ?? 0) / 60)))
const valueOf = (f) => resolution.value.values[f.name] ?? ''
const taken = (f) => takenSides(f, valueOf(f))
const SIDE_LABEL = { lib: 'library', pkg: 'package' }

/** A side can be taken when it has content and the field isn't identical on both sides. */
const canTake = (f, side) => f.status !== 'same' && !!f[side]

/** Take or drop one side; asks before replacing a result edited by hand. `box` is the checkbox, if one was used. */
async function take(f, side, checked, box = null) {
  const next = valueForSides(f, { ...taken(f), [side]: checked })
  const ok =
    !isManualEdit(f, valueOf(f)) ||
    (await confirm(`You've edited the result for "${f.name}" by hand. Replace your edits?`, {
      title: 'Overwrite manual edits?',
      kind: 'warning',
      okLabel: 'Replace',
      cancelLabel: 'Keep my edits',
    }))
  if (ok) resolution.value.values[f.name] = next
  // Re-sync the box with the value: unchanged on cancel, or a no-op toggle.
  if (box) box.checked = taken(f)[side]
}

/** Double-clicking a Library/Package cell toggles its checkbox; not from the box itself or a player. */
function onSideDblclick(f, side, e) {
  if (!canTake(f, side) || e.target.closest('input, button, audio, a')) return
  window.getSelection()?.removeAllRanges()
  take(f, side, !taken(f)[side])
}

function decide(status) {
  resolution.value.status = status
  if (props.index < props.total - 1) emit('next')
}

function reset() {
  state.resolutions[props.entry.guid] = initialResolution(props.entry)
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return
  const actions = {
    a: () => decide('accepted'),
    s: () => decide('skipped'),
    j: () => emit('next'),
    ArrowRight: () => emit('next'),
    k: () => emit('prev'),
    ArrowLeft: () => emit('prev'),
    r: () => (rendered.value = !rendered.value),
    e: () => setAllModes(settings.resultMode === 'code' ? 'editor' : 'code'),
  }
  if (actions[e.key]) {
    e.preventDefault()
    actions[e.key]()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="merge">
    <header class="merge-head">
      <div>
        <h3>{{ entryLabel(entry, settings.mainField) }}</h3>
        <span class="badge">{{ entry.notetype.name }} → {{ entry.libNote.modelName }}</span>
        <span class="badge">matched by {{ entry.matchedBy === 'guid' ? 'GUID' : 'main field' }}</span>
        <span v-if="entry.ambiguous" class="badge warn">several library notes share this main field — matched the first</span>
        <span v-if="entry.sharedWith.length" class="badge warn">
          {{ entry.sharedWith.length }} other package note{{ entry.sharedWith.length === 1 ? '' : 's' }} also match this
          library note
        </span>
        <span class="badge" :class="resolution.status">{{ resolution.status }}</span>
      </div>
      <div class="row">
        <label class="toggle"><input v-model="rendered" type="checkbox" /> Rendered (R)</label>
        <ModeSwitch :model-value="settings.resultMode" label="All Result cells (E)" @update:model-value="setAllModes" />
        <button :disabled="index === 0" @click="emit('prev')">← Prev</button>
        <span class="muted">{{ index + 1 }} / {{ total }}</span>
        <button :disabled="index === total - 1" @click="emit('next')">Next →</button>
      </div>
    </header>

    <table class="fields">
      <thead>
        <tr><th>Field</th><th>Library</th><th>Package</th><th>Result</th></tr>
      </thead>
      <tbody>
        <tr v-for="f in shownFields" :key="f.name" :class="f.status">
          <th>
            <!-- Break long names after underscores (Sound_non_shesa) before breaking mid-word. -->
            <template v-for="(part, i) in f.name.split(/(?<=_)/)" :key="i">{{ part }}<wbr /></template>
            <small v-if="f.pkgName && f.pkgName !== f.name">← {{ f.pkgName }}</small>
            <small>{{ STATUS_LABEL[f.status] }}</small>
          </th>
          <td class="side" @dblclick="onSideDblclick(f, 'lib', $event)">
            <input
              v-if="canTake(f, 'lib')"
              type="checkbox"
              class="take"
              :checked="taken(f).lib"
              :title="`Use the ${SIDE_LABEL.lib} value`"
              :aria-label="`Use the library value for ${f.name}`"
              @change="take(f, 'lib', $event.target.checked, $event.target)"
            />
            <FieldPreview v-if="rendered" :html="f.lib" source="lib" />
            <template v-else>
              <DiffText :a="f.lib" :b="f.pkg" side="lib" />
              <MediaStrip :html="f.lib" source="lib" />
            </template>
          </td>
          <td class="side" @dblclick="onSideDblclick(f, 'pkg', $event)">
            <input
              v-if="canTake(f, 'pkg')"
              type="checkbox"
              class="take"
              :checked="taken(f).pkg"
              :title="`Use the ${SIDE_LABEL.pkg} value`"
              :aria-label="`Use the package value for ${f.name}`"
              @change="take(f, 'pkg', $event.target.checked, $event.target)"
            />
            <FieldPreview v-if="rendered" :html="f.pkg" source="pkg" />
            <template v-else>
              <DiffText :a="f.lib" :b="f.pkg" side="pkg" />
              <MediaStrip :html="f.pkg" source="pkg" />
            </template>
          </td>
          <td class="result" @keydown="onCellKey(f, $event)">
            <ModeSwitch class="float" :model-value="modeOf(f)" :label="`Edit ${f.name} as (Ctrl/Cmd+Shift+X)`" @update:model-value="cellModes[f.name] = $event" />
            <small v-if="isManualEdit(f, valueOf(f))" class="edited">edited by hand</small>
            <template v-if="modeOf(f) === 'editor'">
              <HtmlEditor v-model="resolution.values[f.name]" :font="fontFor(f)" source="result" />
            </template>
            <template v-else>
              <textarea v-model="resolution.values[f.name]" :rows="rows(resolution.values[f.name])" spellcheck="false"></textarea>
              <FieldPreview v-if="rendered" :html="resolution.values[f.name]" source="result" />
              <MediaStrip v-else :html="resolution.values[f.name]" source="result" />
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <button v-if="sameCount" class="link" @click="showSame = !showSame">
      {{ showSame ? 'Hide' : 'Show' }} {{ sameCount }} identical field{{ sameCount === 1 ? '' : 's' }}
    </button>
    <p v-if="entry.tagsToAdd.length" class="muted">Tags added on accept: {{ entry.tagsToAdd.join(', ') }}</p>
    <p v-if="entry.dropped.length" class="warn-text">
      Package fields not mapped to the library note type (ignored): {{ entry.dropped.join(', ') }}
    </p>

    <footer class="row">
      <button class="primary" @click="decide('accepted')">Accept merge (A)</button>
      <button @click="decide('skipped')">Skip note (S)</button>
      <button @click="reset">Reset</button>
      <span class="muted">J/K or ←/→ to move between notes · E toggles Code/Editor</span>
    </footer>
  </div>
</template>
