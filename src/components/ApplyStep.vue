<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel } from '../lib/display.js'

const emit = defineEmits(['preview'])
const { state, settings, plan, applyMerge } = useMergeSession()

const decksToCreate = computed(() => plan.value.decks.filter((d) => !state.libDecks.includes(d)))

const entriesByGuid = computed(() => new Map(state.entries.map((e) => [e.guid, e])))
const labelOf = (guid) => entryLabel(entriesByGuid.value.get(guid), settings.mainField)
const libLabelOf = (id) => {
  const entry = state.entries.find((e) => e.libNote?.id === id)
  return entry ? labelOf(entry.guid) : `note ${id}`
}

const pending = computed(
  () => Object.values(state.resolutions).filter((r) => r.status === 'pending').length,
)
const nothingToDo = computed(
  () => !plan.value.newNotes.length && !plan.value.updates.length && !plan.value.tagAdds.length,
)
const failures = computed(() => {
  const r = state.report
  if (!r) return []
  return [
    ...r.media.failed.map((f) => ({ what: `media ${f.name}`, error: f.error })),
    ...r.added.failed.map((f) => ({ what: `add ${f.guid}`, error: f.error })),
    ...r.updated.failed.map((f) => ({ what: `update ${f.guid}`, error: f.error })),
    ...r.tagged.failed.map((f) => ({ what: `tags ${f.guid}`, error: f.error })),
  ]
})
</script>

<template>
  <section>
    <h2>Apply to library</h2>

    <div class="card">
      <h3>This will</h3>
      <ul>
        <li>Create a full collection backup (aborts if it fails)</li>
        <li v-if="plan.modelsToCreate.length">Create note types: {{ plan.modelsToCreate.map((m) => m.modelName).join(', ') }}</li>
        <li v-if="plan.fieldsToCreate.length">
          Add fields: {{ plan.fieldsToCreate.map((f) => `${f.fieldName} → ${f.modelName}`).join(', ') }}
          <span class="warn-text small">(the next AnkiWeb sync will be a one-way full sync)</span>
        </li>
        <li>
          Add <b>{{ plan.newNotes.length }}</b> new notes to
          <template v-if="plan.decks.length === 1"><b>{{ plan.decks[0] }}</b></template>
          <template v-else-if="plan.decks.length"><b>{{ plan.decks.length }}</b> decks (their package decks)</template>
          <template v-else>no decks (none selected)</template>
          <span v-if="decksToCreate.length" class="muted small">— {{ decksToCreate.length }} deck(s) will be created</span>
        </li>
        <li>Update fields on <b>{{ plan.updates.length }}</b> notes</li>
        <li>Add tags to <b>{{ plan.tagAdds.length }}</b> notes</li>
        <li v-if="plan.mergeTag">Tag every written note with <code>{{ plan.mergeTag }}</code></li>
        <li>Copy <b>{{ plan.media.length }}</b> media files (existing differing files are kept; ours are renamed)</li>
      </ul>
      <p v-if="pending" class="warn-text">{{ pending }} conflict(s) are still undecided and will be skipped.</p>
      <div v-if="plan.collisions.length" class="error">
        <b>{{ plan.collisions.length }} field(s) where package notes disagree about the same library note.</b>
        Go back to Review and skip (or untick) one of them, or make their results identical.
        <ul class="small">
          <li v-for="c in plan.collisions" :key="`${c.id}-${c.field}`">
            <b>{{ libLabelOf(c.id) }}</b> · {{ c.field }}:
            <span v-for="(v, i) in c.values" :key="v.guid">
              {{ i ? ' vs ' : '' }}<code>{{ v.value || '(empty)' }}</code>
            </span>
          </li>
        </ul>
      </div>
      <p v-if="!state.previewed && !state.attempted" class="warn-text small">
        You haven't opened the Preview for this analysis.
        <button class="link" @click="emit('preview')">See every change first →</button>
      </p>
      <p v-else-if="!state.attempted" class="muted small">
        <button class="link" @click="emit('preview')">Review the full preview</button>
      </p>
      <p class="muted small">Close Anki's Browse window first — AnkiConnect can't update a note that's open in it.</p>
      <button
        class="primary"
        :disabled="state.busy || nothingToDo || state.attempted || plan.collisions.length > 0"
        @click="applyMerge"
      >
        {{ state.busy ? state.progress : state.applied ? 'Applied' : state.attempted ? 'Stopped' : 'Back up & merge' }}
      </button>
      <p v-if="state.attempted && !state.busy && !state.applied" class="warn-text small">
        This merge stopped part-way. Some notes may already be written, so re-run <b>Analyze</b> in Configure before
        merging again — it will see what landed and only propose the rest.
      </p>
    </div>

    <div v-if="state.report" class="card">
      <h3>{{ state.applied ? 'Merge complete' : 'Merge stopped' }}</h3>
      <p v-if="state.report.backup">
        Backup: <code>{{ state.report.backup.file }}</code>
        <span v-if="!state.report.backup.created" class="muted small">(unchanged since this backup was made)</span>
        <br /><span class="muted small">Restore via File → Switch Profile → Open Backup.</span>
      </p>
      <ul>
        <li>Added {{ state.report.added.ok }} notes</li>
        <li>Updated {{ state.report.updated.ok }} notes</li>
        <li>Tagged {{ state.report.tagged.ok }} notes</li>
        <li v-if="state.report.fieldsCreated.length">
          Added fields: {{ state.report.fieldsCreated.map((f) => `${f.fieldName} → ${f.modelName}`).join(', ') }}
        </li>
        <li>
          Stored {{ state.report.media.stored }} media files
          <span v-if="Object.keys(state.report.media.renamed).length">
            ({{ Object.keys(state.report.media.renamed).length }} renamed to avoid overwriting library files)
          </span>
        </li>
      </ul>
      <details v-if="failures.length" open>
        <summary class="warn-text">{{ failures.length }} failure(s)</summary>
        <ul class="small">
          <li v-for="(f, i) in failures" :key="i"><code>{{ f.what }}</code>: {{ f.error }}</li>
        </ul>
      </details>
      <details>
        <summary class="muted">Log</summary>
        <ol class="small"><li v-for="(l, i) in state.applyLog" :key="i">{{ l }}</li></ol>
      </details>
    </div>
  </section>
</template>
