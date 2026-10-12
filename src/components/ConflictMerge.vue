<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { initialResolution } from '../lib/match.js'
import { entryLabel, STATUS_LABEL } from '../lib/display.js'
import DiffText from './DiffText.vue'
import FieldPreview from './FieldPreview.vue'

const props = defineProps({
  entry: { type: Object, required: true },
  index: { type: Number, required: true },
  total: { type: Number, required: true },
})
const emit = defineEmits(['prev', 'next'])

const { state, settings } = useMergeSession()
const rendered = ref(false)
const showSame = ref(false)

const resolution = computed(() => state.resolutions[props.entry.guid])
const shownFields = computed(() => props.entry.fields.filter((f) => showSame.value || f.status !== 'same'))
const sameCount = computed(() => props.entry.fields.filter((f) => f.status === 'same').length)

const rows = (text) => Math.min(12, Math.max(2, Math.ceil((text?.length ?? 0) / 60)))
const pick = (field, value) => (resolution.value.values[field.name] = value)
const combine = (f) => (f.lib && f.pkg ? `${f.lib}<br>${f.pkg}` : f.lib || f.pkg)
const chosen = (f, value) => resolution.value.values[f.name] === value

function decide(status) {
  resolution.value.status = status
  if (props.index < props.total - 1) emit('next')
}

function reset() {
  state.resolutions[props.entry.guid] = initialResolution(props.entry)
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || ['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)) return
  const actions = {
    a: () => decide('accepted'),
    s: () => decide('skipped'),
    j: () => emit('next'),
    ArrowRight: () => emit('next'),
    k: () => emit('prev'),
    ArrowLeft: () => emit('prev'),
    r: () => (rendered.value = !rendered.value),
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
            {{ f.name }}
            <small>{{ STATUS_LABEL[f.status] }}</small>
          </th>
          <td>
            <FieldPreview v-if="rendered" :html="f.lib" source="lib" />
            <DiffText v-else :a="f.lib" :b="f.pkg" side="lib" />
          </td>
          <td>
            <FieldPreview v-if="rendered" :html="f.pkg" source="pkg" />
            <DiffText v-else :a="f.lib" :b="f.pkg" side="pkg" />
          </td>
          <td class="result">
            <div class="pick">
              <button :class="{ on: chosen(f, f.lib) }" @click="pick(f, f.lib)">Library</button>
              <button :class="{ on: chosen(f, f.pkg) }" @click="pick(f, f.pkg)">Package</button>
              <button :class="{ on: chosen(f, combine(f)) }" @click="pick(f, combine(f))">Both</button>
            </div>
            <textarea v-model="resolution.values[f.name]" :rows="rows(resolution.values[f.name])" spellcheck="false"></textarea>
            <FieldPreview v-if="rendered" :html="resolution.values[f.name]" source="result" />
          </td>
        </tr>
      </tbody>
    </table>

    <button v-if="sameCount" class="link" @click="showSame = !showSame">
      {{ showSame ? 'Hide' : 'Show' }} {{ sameCount }} identical field{{ sameCount === 1 ? '' : 's' }}
    </button>
    <p v-if="entry.tagsToAdd.length" class="muted">Tags added on accept: {{ entry.tagsToAdd.join(', ') }}</p>
    <p v-if="entry.dropped.length" class="warn-text">
      Package fields not in the library note type (ignored): {{ entry.dropped.join(', ') }}
    </p>

    <footer class="row">
      <button class="primary" @click="decide('accepted')">Accept merge (A)</button>
      <button @click="decide('skipped')">Skip note (S)</button>
      <button @click="reset">Reset</button>
      <span class="muted">J/K or ←/→ to move between notes</span>
    </footer>
  </div>
</template>
