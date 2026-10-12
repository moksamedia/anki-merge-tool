<script setup>
import { computed, ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel } from '../lib/display.js'
import ConflictMerge from './ConflictMerge.vue'
import MergedNote from './MergedNote.vue'
import FieldMapPanel from './FieldMapPanel.vue'

const emit = defineEmits(['done'])
const { state, settings, counts, pkgDeckName } = useMergeSession()
const deckOf = (e) => (state.deckMode === 'package' && pkgDeckName(e.pkgNote.deckId)) || state.targetDeck

const tab = ref(counts.value.conflict ? 'conflict' : counts.value.auto || counts.value.new ? 'auto' : 'merged')
const current = ref(0)
const currentMerged = ref(0)

// Notes already written by an earlier run sit in their own tab, read-only.
const open = (e) => !state.merged[e.guid]
const byKind = (kind) => state.entries.filter((e) => open(e) && e.kind === kind)
const conflicts = computed(() => byKind('conflict'))
const autos = computed(() => byKind('auto'))
const news = computed(() => byKind('new'))
const mergedEntries = computed(() =>
  state.entries
    .filter((e) => !open(e))
    .sort((a, b) => (state.merged[b.guid].at ?? '').localeCompare(state.merged[a.guid].at ?? '')),
)

const decided = computed(() => conflicts.value.filter((e) => state.resolutions[e.guid].status !== 'pending').length)
const STATUS_ICON = { pending: '○', accepted: '✓', skipped: '–' }
const KIND_ICON = { new: '+', auto: '~', conflict: '✓' }

const label = (e) => entryLabel(e, settings.mainField)
const included = (e) => !state.excluded.has(e.guid)
function toggle(e) {
  if (state.excluded.has(e.guid)) state.excluded.delete(e.guid)
  else state.excluded.add(e.guid)
}

// Remapping fields re-classifies, which can shrink the lists.
watch(
  () => conflicts.value.length,
  (n) => (current.value = Math.max(0, Math.min(current.value, n - 1))),
)
watch(
  () => mergedEntries.value.length,
  (n) => (currentMerged.value = Math.max(0, Math.min(currentMerged.value, n - 1))),
)

const move = (delta) => {
  current.value = Math.min(conflicts.value.length - 1, Math.max(0, current.value + delta))
}

const savedAt = computed(() => (state.session.savedAt ? new Date(state.session.savedAt).toLocaleTimeString() : null))
</script>

<template>
  <section>
    <div class="row spread">
      <h2>Review</h2>
      <span v-if="savedAt" class="muted small" :title="state.session.path">Session saved {{ savedAt }}</span>
    </div>
    <div class="stats">
      <button :class="{ on: tab === 'conflict' }" @click="tab = 'conflict'">
        <b>{{ counts.conflict }}</b> conflicts <small>{{ decided }} decided</small>
      </button>
      <button :class="{ on: tab === 'auto' }" @click="tab = 'auto'"><b>{{ counts.auto }}</b> auto-merges</button>
      <button :class="{ on: tab === 'new' }" @click="tab = 'new'"><b>{{ counts.new }}</b> new notes</button>
      <button :class="{ on: tab === 'merged' }" @click="tab = 'merged'"><b>{{ counts.merged }}</b> merged</button>
      <div><b>{{ counts.identical }}</b> identical</div>
    </div>
    <p v-if="counts.shared" class="warn-text small">
      {{ counts.shared }} package notes share a library note with another package note (marked ⚠). Where they want
      different values for a field, applying is blocked until you skip one or make them agree.
    </p>
    <p v-if="counts.ambiguous" class="warn-text small">
      {{ counts.ambiguous }} note(s) matched more than one library note by main field; the first match is used.
    </p>
    <p v-if="counts.dropped" class="warn-text small">
      {{ counts.dropped }} matched note(s) have package content in fields not mapped to their library note type; that
      content is not merged (each note's merge view lists the fields; map them under Field mapping below).
    </p>

    <FieldMapPanel />

    <div v-if="tab === 'conflict'">
      <p v-if="!conflicts.length" class="muted">No conflicts.</p>
      <div v-else class="split">
        <ol class="note-list">
          <li
            v-for="(e, i) in conflicts"
            :key="e.guid"
            :class="[{ on: i === current }, state.resolutions[e.guid].status]"
            @click="current = i"
          >
            <span class="icon">{{ STATUS_ICON[state.resolutions[e.guid].status] }}</span>
            <span v-if="e.sharedWith.length" class="warn-text">⚠ </span>{{ label(e) }}
          </li>
        </ol>
        <ConflictMerge
          :key="conflicts[current].guid"
          :entry="conflicts[current]"
          :index="current"
          :total="conflicts.length"
          @prev="move(-1)"
          @next="move(1)"
        />
      </div>
    </div>

    <div v-else-if="tab === 'auto'" class="card">
      <p class="muted small">Only empty library fields are filled and new tags added; nothing existing is overwritten.</p>
      <table class="plain">
        <thead><tr><th></th><th>Note</th><th>Fills</th><th>New tags</th></tr></thead>
        <tbody>
          <tr v-for="e in autos" :key="e.guid" :class="{ excluded: !included(e) }">
            <td><input type="checkbox" :checked="included(e)" @change="toggle(e)" /></td>
            <td><span v-if="e.sharedWith.length" class="warn-text" title="Shares a library note with another package note">⚠ </span>{{ label(e) }}</td>
            <td class="small">
              <div v-for="f in e.fields.filter((x) => x.status === 'fill')" :key="f.name">
                <b>{{ f.name }}:</b> {{ f.pkg }}
              </div>
            </td>
            <td class="small">{{ e.tagsToAdd.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="tab === 'new'" class="card">
      <p class="muted small">
        <template v-if="state.deckMode === 'package'">Each note is added to the deck it has in the package.</template>
        <template v-else>Added to deck <b>{{ state.targetDeck }}</b>.</template>
      </p>
      <table class="plain">
        <thead><tr><th></th><th>Note</th><th>Note type</th><th>Deck</th><th>Tags</th></tr></thead>
        <tbody>
          <tr v-for="e in news" :key="e.guid" :class="{ excluded: !included(e) }">
            <td><input type="checkbox" :checked="included(e)" @change="toggle(e)" /></td>
            <td>{{ label(e) }}</td>
            <td class="small">{{ e.target.modelName }}<span v-if="e.target.create" class="badge">new</span></td>
            <td class="small">{{ deckOf(e) }}</td>
            <td class="small">{{ e.pkgNote.tags.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else>
      <p v-if="!mergedEntries.length" class="muted">Nothing has been merged yet.</p>
      <div v-else class="split">
        <ol class="note-list">
          <li
            v-for="(e, i) in mergedEntries"
            :key="e.guid"
            :class="{ on: i === currentMerged }"
            :title="`${state.merged[e.guid].kind}, run ${state.merged[e.guid].run}`"
            @click="currentMerged = i"
          >
            <span class="icon ok-text">{{ KIND_ICON[state.merged[e.guid].kind] ?? '✓' }}</span>{{ label(e) }}
          </li>
        </ol>
        <MergedNote :key="mergedEntries[currentMerged].guid" :entry="mergedEntries[currentMerged]" />
      </div>
    </div>

    <button class="primary" @click="emit('done')">Continue to preview →</button>
  </section>
</template>

<style scoped>
.spread { justify-content: space-between; }
</style>
