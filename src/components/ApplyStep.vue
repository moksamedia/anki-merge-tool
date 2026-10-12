<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel } from '../lib/display.js'

const { state, settings, plan, applyMerge } = useMergeSession()

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
        <li>Add <b>{{ plan.newNotes.length }}</b> new notes to <b>{{ plan.targetDeck }}</b></li>
        <li>Update fields on <b>{{ plan.updates.length }}</b> notes</li>
        <li>Add tags to <b>{{ plan.tagAdds.length }}</b> notes</li>
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
      <p class="muted small">Close Anki's Browse window first — AnkiConnect can't update a note that's open in it.</p>
      <button
        class="primary"
        :disabled="state.busy || nothingToDo || state.applied || plan.collisions.length > 0"
        @click="applyMerge"
      >
        {{ state.busy ? state.progress : state.applied ? 'Applied' : 'Back up & merge' }}
      </button>
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
