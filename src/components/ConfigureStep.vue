<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { mainFieldName } from '../lib/match.js'
import { pairKey, unmappedFields } from '../lib/fieldMap.js'
import { sanitizeTag } from '../lib/applyMerge.js'

const emit = defineEmits(['done'])
const { settings, state, fieldMapOf, libFieldsOf, fieldPairs, setNoteTypeTarget, runAnalysis } = useMergeSession()

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

function setTarget(nt, value) {
  return setNoteTypeTarget(
    nt,
    value === '__create__' ? { modelName: createName(nt), create: true } : { modelName: value, create: false },
  )
}

/** A free name for a new note type: the package name, suffixed if taken. */
function createName(nt) {
  let name = nt.name
  for (let i = 2; state.libModels.includes(name); i++) name = `${nt.name} (${i})`
  return name
}

/** Per row: the field the type matches on, and which package fields its new notes leave out. */
const rows = computed(() =>
  usedTypes.value.map((nt) => {
    const m = state.mapping[nt.id]
    if (m.create) return { nt, unmapped: [], main: mainFieldName(nt.fields, settings.mainField) }
    const libFields = libFieldsOf(m.modelName)
    const pair = { key: pairKey(nt.id, m.modelName), notetype: nt, modelName: m.modelName, libFields }
    return { nt, unmapped: unmappedFields(nt.fields, fieldMapOf(pair)), main: mainFieldName(libFields, settings.mainField) }
  }),
)

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

// Field maps come after analysis, once it's known which library note types the notes go through.
async function analyze() {
  await runAnalysis()
  if (state.entries.length && !state.error) emit('done', { needsFields: fieldPairs.value.length > 0 })
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
      <p class="muted small">
        Field maps are set after analysis, once it's known which library note types the notes match: these targets, and
        any other type a package note already exists under.
      </p>
    </div>

    <button class="primary" :disabled="state.busy || !canAnalyze" @click="analyze">Analyze against library</button>
  </section>
</template>
