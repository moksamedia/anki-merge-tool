<script setup>
import { computed, ref } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { mainFieldName, namedFields } from '../lib/match.js'
import { needsFieldMap, pairKey, unmappedFields } from '../lib/fieldMap.js'
import { sanitizeTag } from '../lib/applyMerge.js'
import FieldMapTable from './FieldMapTable.vue'

const emit = defineEmits(['done'])
const { settings, state, fieldMapOf, loadModelFields, runAnalysis } = useMergeSession()

// Field mapping stays hidden by default: fields pair by name unless the user
// opens it and chooses otherwise.
const showFields = ref(false)

// Only note types that actually have notes in the package need a target.
const usedTypes = computed(() => {
  const ids = new Set(state.pkg.notes.map((n) => n.notetypeId))
  return state.pkg.notetypes.filter((nt) => ids.has(nt.id))
})

const allFieldNames = computed(() => [...new Set(usedTypes.value.flatMap((nt) => nt.fields))])

function targetValue(nt) {
  const m = state.mapping[nt.id]
  return m.create ? '__create__' : m.modelName
}

async function setTarget(nt, value) {
  state.mapping[nt.id] =
    value === '__create__' ? { modelName: createName(nt), create: true } : { modelName: value, create: false }
  await loadModelFields()
}

/** A free name for a new note type: the package name, suffixed if taken. */
function createName(nt) {
  let name = nt.name
  for (let i = 2; state.libModels.includes(name); i++) name = `${nt.name} (${i})`
  return name
}

// A few package notes per type, for the field map's example column.
const samples = computed(() => {
  const out = new Map()
  for (const note of state.pkg.notes) {
    const list = out.get(note.notetypeId) ?? []
    if (list.length < 20) out.set(note.notetypeId, [...list, note])
  }
  const types = new Map(state.pkg.notetypes.map((nt) => [nt.id, nt]))
  return new Map([...out].map(([id, notes]) => [id, notes.map((n) => namedFields(n, types.get(id)))]))
})

/** Per row: the field-map pair new notes go through (null when creating a type), and what it leaves out. */
const rows = computed(() =>
  usedTypes.value.map((nt) => {
    const m = state.mapping[nt.id]
    if (m.create) return { nt, pair: null, needsMap: false, unmapped: [], main: mainFieldName(nt.fields, settings.mainField) }
    const libFields = state.libModelFields[m.modelName] ?? []
    const pair = { key: pairKey(nt.id, m.modelName), notetype: nt, modelName: m.modelName, libFields, samples: samples.value.get(nt.id) ?? [] }
    return {
      nt,
      pair,
      needsMap: needsFieldMap(nt, m.modelName, libFields),
      unmapped: unmappedFields(nt.fields, fieldMapOf(pair)),
      main: mainFieldName(libFields, settings.mainField),
    }
  }),
)

/** Rows whose package and library note types don't line up — the ones the field mapping lists. */
const mapRows = computed(() => rows.value.filter((r) => r.needsMap))

const createNameTaken = (nt) => state.mapping[nt.id].create && state.libModels.includes(state.mapping[nt.id].modelName)

const mergeTagPreview = computed(() => sanitizeTag(state.mergeTag))

const pkgDeckCount = computed(() => new Set(state.pkg.notes.map((n) => n.deckId)).size)
const newDecks = computed(() => {
  const used = new Set(state.pkg.notes.map((n) => n.deckId))
  return state.pkg.decks.filter((d) => used.has(d.id) && !state.libDecks.includes(d.name)).map((d) => d.name)
})

const canAnalyze = computed(
  () => (state.deckMode === 'package' || state.targetDeck.trim()) && !usedTypes.value.some(createNameTaken),
)

async function analyze() {
  await runAnalysis()
  if (state.entries.length && !state.error) emit('done')
}
</script>

<template>
  <section>
    <h2>Configure the merge</h2>

    <div class="grid2">
      <div class="card">
        <h3>Matching</h3>
        <label>
          Main field
          <input v-model.trim="settings.mainField" list="field-names" />
          <datalist id="field-names"><option v-for="f in allFieldNames" :key="f" :value="f" /></datalist>
        </label>
        <p class="muted small">
          Notes match by GUID first; otherwise by this field across the whole library (any deck, any note type), ignoring
          formatting, case, Unicode spelling of stacks, and trailing tsheg/shad. A package note type without this field
          falls back to its first field, matched only within the library note type it maps to.
        </p>
        <label class="toggle">
          <input v-model="settings.ignoreGuid" type="checkbox" />
          Ignore GUIDs — match on the main field only
        </label>
        <p v-if="settings.ignoreGuid" class="muted small">
          Use when the package came from a different source than your notes, so shared GUIDs would be coincidental or
          stale.
        </p>
        <label class="toggle">
          <input v-model="settings.autoFillEmpty" type="checkbox" />
          Fill empty library fields automatically (no review needed)
        </label>
      </div>
      <div class="card">
        <h3>New notes</h3>
        <label class="toggle">
          <input v-model="state.deckMode" type="radio" value="package" />
          Keep each note's package deck
          <span class="muted small">({{ pkgDeckCount }} deck{{ pkgDeckCount === 1 ? '' : 's' }})</span>
        </label>
        <p v-if="state.deckMode === 'package'" class="muted small">
          <template v-if="newDecks.length">
            {{ newDecks.length }} of these don't exist in the library and will be created, parents included.
          </template>
          <template v-else>All of these decks already exist in the library.</template>
        </p>
        <label class="toggle">
          <input v-model="state.deckMode" type="radio" value="single" />
          Put all new notes in one deck
        </label>
        <label v-if="state.deckMode === 'single'">
          Target deck
          <input v-model.trim="state.targetDeck" list="deck-names" />
          <datalist id="deck-names"><option v-for="d in state.libDecks" :key="d" :value="d" /></datalist>
        </label>
        <p v-if="state.deckMode === 'single'" class="muted small">
          {{ state.libDecks.includes(state.targetDeck) ? 'Existing deck.' : 'Will be created.' }}
        </p>
        <p class="muted small">Only new notes are placed; updated notes keep their current deck.</p>
      </div>
      <div class="card">
        <h3>Merge tag</h3>
        <label>
          Tag for every note this merge writes
          <input v-model="state.mergeTag" spellcheck="false" placeholder="(none)" />
        </label>
        <p class="muted small">
          Added to new notes and to notes whose fields or tags change, so you can find everything from this run in Anki
          with <code>tag:{{ mergeTagPreview || '…' }}</code>. Untouched notes don't get it. Leave blank for no tag.
        </p>
      </div>
    </div>

    <div class="card">
      <h3>Note types</h3>
      <table class="plain">
        <thead><tr><th>Package note type</th><th>Library note type</th><th>Fields</th></tr></thead>
        <tbody>
          <tr v-for="{ nt, unmapped, main } in rows" :key="nt.id">
            <td>{{ nt.name }}</td>
            <td>
              <select :value="targetValue(nt)" @change="setTarget(nt, $event.target.value)">
                <option value="__create__">Create new note type</option>
                <option v-for="m in state.libModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <input v-if="state.mapping[nt.id].create" v-model.trim="state.mapping[nt.id].modelName" class="inline" />
              <span v-if="createNameTaken(nt)" class="warn-text small">name already exists</span>
            </td>
            <td class="small">
              <span>matching on <b>{{ main }}</b></span>
              <span v-if="unmapped.length" class="warn-text"> · not imported: {{ unmapped.join(', ') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <button v-if="mapRows.length" :aria-expanded="showFields" class="fields-toggle" @click="showFields = !showFields">
        {{ showFields ? 'Hide field mapping' : 'Configure fields' }}
      </button>
    </div>

    <div v-if="showFields && mapRows.length" class="card">
      <h3>Field mapping</h3>
      <p class="muted small">
        Choose which package field fills each library field. Same-named fields are paired automatically; choices are
        remembered for the next package with the same note types. Notes that match into other library note types can be
        mapped in Review.
      </p>
      <div v-for="{ pair } in mapRows" :key="pair.key" class="pair">
        <div class="map-head">
          <h3>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h3>
        </div>
        <FieldMapTable :pair="pair" />
      </div>
    </div>

    <button class="primary" :disabled="state.busy || !canAnalyze" @click="analyze">Analyze against library</button>
  </section>
</template>
