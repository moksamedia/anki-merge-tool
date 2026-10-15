<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { sanitizeTag } from '../lib/applyMerge.js'

const emit = defineEmits(['done'])
const { settings, state, runAnalysis } = useMergeSession()

// Only note types that actually have notes in the package need a target.
const usedTypes = computed(() => {
  const ids = new Set(state.pkg.notes.map((n) => n.notetypeId))
  return state.pkg.notetypes.filter((nt) => ids.has(nt.id))
})

const allFieldNames = computed(() => [...new Set(usedTypes.value.flatMap((nt) => nt.fields))])

const mergeTagPreview = computed(() => sanitizeTag(state.mergeTag))

const pkgDeckCount = computed(() => new Set(state.pkg.notes.map((n) => n.deckId)).size)
const newDecks = computed(() => {
  const used = new Set(state.pkg.notes.map((n) => n.deckId))
  return state.pkg.decks.filter((d) => used.has(d.id) && !state.libDecks.includes(d.name)).map((d) => d.name)
})

const canAnalyze = computed(() => state.deckMode === 'package' || state.targetDeck.trim())

// Note types and field maps come after analysis, once it's known which library
// note types the notes go through. Until then each type maps to its remembered
// or same-named library type, or a new one.
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
          Notes match by GUID first, otherwise by this field, ignoring formatting, case, Unicode spelling of stacks, and
          trailing tsheg/shad. Each package note type is matched only against the library note type it maps to (set after
          analysis, on Note types); a note whose field exists only in another type is listed in Review as a possible
          duplicate. A package note type without this field falls back to its first field.
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

    <button class="primary" :disabled="state.busy || !canAnalyze" @click="analyze">Analyze against library</button>
  </section>
</template>
