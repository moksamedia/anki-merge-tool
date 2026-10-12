<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel } from '../lib/display.js'
import { runFailures } from '../lib/session.js'

const emit = defineEmits(['preview'])
const { state, settings, counts, plan, applyMerge } = useMergeSession()

const decksToCreate = computed(() => plan.value.decks.filter((d) => !state.libDecks.includes(d)))

const entriesByGuid = computed(() => new Map(state.entries.map((e) => [e.guid, e])))
const labelOf = (guid) => entryLabel(entriesByGuid.value.get(guid), settings.mainField)
const libLabelOf = (id) => {
  const entry = state.entries.find((e) => e.libNote?.id === id)
  return entry ? labelOf(entry.guid) : `note ${id}`
}

// Open notes this run leaves alone because they aren't accepted (merging is opt-in).
const notAccepted = computed(() => {
  const c = counts.value
  const parts = [
    [c.new - c.accepted.new, 'new note'],
    [c.auto - c.accepted.auto, 'auto-merge'],
    [c.conflict - c.accepted.conflict, 'conflict'],
  ].filter(([n]) => n > 0)
  return parts.map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`)
})
// Package notes this run writes: added, updated or tagged.
const toWrite = computed(
  () =>
    new Set([
      ...plan.value.newNotes.map((n) => n.guid),
      ...plan.value.updates.flatMap((u) => u.guids),
      ...plan.value.tagAdds.flatMap((t) => t.guids),
    ]).size,
)
const nothingToDo = computed(() => toWrite.value === 0)
const lastRun = computed(() => state.runs[state.runs.length - 1] ?? null)
const failures = computed(() => runFailures(state.report))
const when = (iso) => new Date(iso).toLocaleString()
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
        <li v-if="counts.merged">Leave alone <b>{{ counts.merged }}</b> notes already merged in earlier runs</li>
      </ul>
      <p v-if="notAccepted.length" class="warn-text">
        {{ notAccepted.length > 1 ? notAccepted.slice(0, -1).join(', ') + ' and ' + notAccepted.at(-1) : notAccepted[0] }}
        aren't accepted and will be left alone. Accept them in Review and merge again later.
      </p>
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
      <p v-if="!state.previewed && !nothingToDo" class="warn-text small">
        You haven't opened the Preview for this analysis.
        <button class="link" @click="emit('preview')">See every change first →</button>
      </p>
      <p v-else-if="!nothingToDo" class="muted small">
        <button class="link" @click="emit('preview')">Review the full preview</button>
      </p>
      <p class="muted small">Close Anki's Browse window first — AnkiConnect can't update a note that's open in it.</p>
      <button class="primary" :disabled="state.busy || nothingToDo || plan.collisions.length > 0" @click="applyMerge">
        <template v-if="state.busy">{{ state.progress }}</template>
        <template v-else-if="nothingToDo">Nothing approved to merge</template>
        <template v-else>Back up &amp; merge {{ toWrite }} note{{ toWrite === 1 ? '' : 's' }}</template>
      </button>
      <p v-if="nothingToDo && !state.busy" class="muted small">
        Nothing accepted yet — accept notes in Review (tick new notes and auto-merges, accept conflicts) and come back.
      </p>
    </div>

    <div v-if="state.report && lastRun" class="card">
      <h3>{{ lastRun.error ? 'Merge stopped' : 'Merge complete' }} <span class="muted">· run {{ lastRun.run }}</span></h3>
      <p v-if="lastRun.error" class="error">{{ lastRun.error }}</p>
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
        <li><b>{{ lastRun.merged }}</b> package notes recorded as merged; they are listed under Merged in Review.</li>
      </ul>
      <details v-if="failures.length" open>
        <summary class="warn-text">{{ failures.length }} failure(s)</summary>
        <p class="small">These notes stay approved. Fix the cause (an open Browse window, for instance) and merge again.</p>
        <ul class="small">
          <li v-for="(f, i) in failures" :key="i"><code>{{ f.what }}</code>: {{ f.error }}</li>
        </ul>
      </details>
      <details>
        <summary class="muted">Log</summary>
        <ol class="small"><li v-for="(l, i) in state.applyLog" :key="i">{{ l }}</li></ol>
      </details>
    </div>

    <details v-if="state.runs.length" class="card runs">
      <summary>{{ state.runs.length }} earlier run{{ state.runs.length === 1 ? '' : 's' }} on this package</summary>
      <table class="plain small">
        <thead><tr><th>Run</th><th>When</th><th>Added</th><th>Updated</th><th>Tagged</th><th>Merged</th><th>Failures</th><th>Backup</th></tr></thead>
        <tbody>
          <tr v-for="r in state.runs" :key="r.run">
            <td>{{ r.run }}</td>
            <td>{{ when(r.at) }}</td>
            <td>{{ r.added }}</td>
            <td>{{ r.updated }}</td>
            <td>{{ r.tagged }}</td>
            <td>{{ r.merged }}</td>
            <td :class="{ 'warn-text': r.failures.length || r.error }">{{ r.failures.length }}{{ r.error ? ' · stopped' : '' }}</td>
            <td><code v-if="r.backup">{{ r.backup }}</code></td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
</template>

<style scoped>
.runs summary { cursor: pointer; }
.runs table { margin-top: 8px; }
</style>
