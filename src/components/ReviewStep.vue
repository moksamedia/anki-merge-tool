<script setup>
import { computed, ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel, summaryFields } from '../lib/display.js'
import { pairKey } from '../lib/fieldMap.js'
import { entryMatches, isFiltering } from '../lib/reviewFilter.js'
import ConflictMerge from './ConflictMerge.vue'
import MediaStrip from './MediaStrip.vue'
import MergedNote from './MergedNote.vue'
import ReviewFilter from './ReviewFilter.vue'

const emit = defineEmits(['done', 'fields'])
const {
  state,
  settings,
  counts,
  fieldPairs,
  crossTypePairs,
  pkgDeckName,
  acceptAll,
  clearAll,
  acceptAllWithoutConflict,
  setAccepted,
  decideDuplicate,
  decideAllDuplicates,
  openInAnki,
} = useMergeSession()
const deckOf = (e) => (state.deckMode === 'package' && pkgDeckName(e.pkgNote.deckId)) || state.targetDeck

const tab = ref(
  counts.value.conflict
    ? 'conflict'
    : counts.value.auto || counts.value.new
      ? 'auto'
      : counts.value.duplicate
        ? 'duplicate'
        : 'merged',
)
const current = ref(0)
const currentMerged = ref(0)

// Every list shows only what the filter lets through; counts and bulk actions follow it.
const filtering = computed(() => isFiltering(state.reviewFilter))
const shown = computed(() => state.entries.filter((e) => entryMatches(e, state.reviewFilter)))
/** Bulk actions act on the notes shown: the guids of `list` while filtering, else everything (null). */
const scope = (list) => (filtering.value ? new Set(list.map((e) => e.guid)) : null)

// Notes already written by an earlier run sit in their own tab, read-only.
const open = (e) => !state.merged[e.guid]
const byKind = (kind) => shown.value.filter((e) => open(e) && e.kind === kind)
const conflicts = computed(() => byKind('conflict'))
const autos = computed(() => byKind('auto'))
// Possible duplicates (new notes whose main field already exists in another
// library note type) are decided in their own tab, not ticked with new notes.
const isDuplicate = (e) => e.kind === 'new' && e.elsewhere?.length > 0
const news = computed(() => byKind('new').filter((e) => !isDuplicate(e)))
const duplicates = computed(() => shown.value.filter((e) => open(e) && (isDuplicate(e) || e.crossType)))
const identicals = computed(() => byKind('identical'))
const undecidedOnly = ref(false)
const dupDecision = (e) => (e.crossType ? 'merge' : state.dupDecisions[e.guid] ?? null)
const shownDuplicates = computed(() =>
  undecidedOnly.value ? duplicates.value.filter((e) => !dupDecision(e)) : duplicates.value,
)
const libById = computed(() => new Map(state.libNotes.map((n) => [n.id, n])))
/** The notes of other types a possible duplicate would duplicate. */
const othersOf = (e) =>
  (state.matches?.get(e.guid)?.elsewhere ?? []).map((id) => libById.value.get(id)).filter(Boolean)
const fieldLines = (fields) => summaryFields(fields, settings.mainField)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// Open Note types at the pair a cross-type merge goes through.
const checkPair = (e) => emit('fields', pairKey(e.notetype.id, e.libNote.modelName))
// All of a note's field HTML, for MediaStrip to find its images and sounds.
const mediaHtml = (fields) => Object.values(fields ?? {}).join(' ')
const mergedEntries = computed(() =>
  shown.value
    .filter((e) => !open(e))
    .sort((a, b) => (state.merged[b.guid].at ?? '').localeCompare(state.merged[a.guid].at ?? '')),
)

const decided = computed(() => conflicts.value.filter((e) => state.resolutions[e.guid].status !== 'pending').length)
const acceptedConflicts = computed(() => conflicts.value.filter((e) => state.resolutions[e.guid].status === 'accepted').length)
const acceptedIn = (list) => list.filter((e) => state.accepted.has(e.guid)).length
const acceptedAutos = computed(() => acceptedIn(autos.value))
const acceptedNews = computed(() => acceptedIn(news.value))
const decidedDuplicates = computed(() => duplicates.value.filter((e) => dupDecision(e)).length)
const STATUS_ICON = { pending: '○', accepted: '✓', skipped: '–' }
const KIND_ICON = { new: '+', auto: '~', conflict: '✓' }

const label = (e) => entryLabel(e, settings.mainField)
const warnTitle = (e) =>
  [
    e.ambiguous && `${e.candidates.length} library notes share this main field`,
    e.sharedWith.length && 'Shares a library note with another package note',
  ]
    .filter(Boolean)
    .join('; ')
// Merging is opt-in: a ticked box means "accepted", and only accepted notes are written.
const isAccepted = (e) => state.accepted.has(e.guid)
const toggle = (e) => setAccepted(e.guid, !isAccepted(e))
const openWithoutConflict = computed(() => news.value.length + autos.value.length)
const acceptedWithoutConflict = computed(() => acceptedNews.value + acceptedAutos.value)
/** "of N" after a filtered count, so the total stays in view. */
const ofTotal = (total) => (filtering.value ? ` of ${total}` : '')

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
    <p class="muted small">
      Nothing is written unless you accept it: tick new notes and auto-merges, and accept conflicts one by one.
    </p>
    <ReviewFilter />
    <div class="stats">
      <button :class="{ on: tab === 'conflict' }" @click="tab = 'conflict'">
        <b>{{ conflicts.length }}</b>{{ ofTotal(counts.conflict) }} conflicts
        <small>{{ decided }} decided · {{ acceptedConflicts }} accepted</small>
      </button>
      <button :class="{ on: tab === 'auto' }" @click="tab = 'auto'">
        <b>{{ autos.length }}</b>{{ ofTotal(counts.auto) }} auto-merges <small>{{ acceptedAutos }} accepted</small>
      </button>
      <button :class="{ on: tab === 'new' }" @click="tab = 'new'">
        <b>{{ news.length }}</b>{{ ofTotal(counts.new) }} new notes <small>{{ acceptedNews }} accepted</small>
      </button>
      <button :class="{ on: tab === 'duplicate' }" @click="tab = 'duplicate'">
        <b>{{ duplicates.length }}</b>{{ ofTotal(counts.duplicate) }} possible duplicates
        <small>{{ decidedDuplicates }} decided</small>
      </button>
      <button :class="{ on: tab === 'merged' }" @click="tab = 'merged'">
        <b>{{ mergedEntries.length }}</b>{{ ofTotal(counts.merged) }} merged
      </button>
      <div><b>{{ identicals.length }}</b>{{ ofTotal(counts.identical) }} identical</div>
      <button
        class="accept-all"
        :disabled="acceptedWithoutConflict === openWithoutConflict"
        :title="filtering ? 'Accept every new note and auto-merge the filter shows' : 'Accept every new note and auto-merge; conflicts still need deciding one by one'"
        @click="acceptAllWithoutConflict(scope([...news, ...autos]))"
      >
        Accept all without conflicts ({{ openWithoutConflict }})
      </button>
    </div>
    <p v-if="counts.shared" class="warn-text small">
      {{ counts.shared }} package notes share a library note with another package note (marked ⚠). Where they want
      different values for a field, applying is blocked until you skip one or make them agree.
    </p>
    <p v-if="counts.ambiguous" class="warn-text small">
      {{ counts.ambiguous }} note(s) matched more than one library note by main field (marked ⚠ under Conflicts). The
      closest library note is used; each is a conflict so you can check it, or pick another note, before it's merged.
    </p>
    <p v-if="counts.dropped" class="warn-text small">
      {{ counts.dropped }} matched note(s) have package content in fields not mapped to their library note type; that
      content is not merged (each note's merge view lists the fields; map them on the Note types step).
    </p>

    <div v-if="crossTypePairs.length" class="card pairings">
      <p class="small">
        <b class="warn-text">New note type pairings.</b> Merging possible duplicates into notes of another type paired these
        package note types with library types they aren't mapped to. Their fields pair by name until you change them, so
        check each field mapping.
      </p>
      <ul class="small">
        <li v-for="p in crossTypePairs" :key="p.key">
          <b>{{ p.notetype.name }} → {{ p.modelName }}</b>
          <span class="muted"> · {{ plural(p.matched, 'note') }}</span>
          <span v-if="p.unmapped.length" class="warn-text"> · {{ plural(p.unmapped.length, 'package field') }} not imported</span>
          <span v-else class="ok-text"> · every package field has a home</span>
          · <button class="link" @click="emit('fields', p.key)">Check field mapping →</button>
        </li>
      </ul>
    </div>

    <p class="small">
      Note types and fields ·
      <span v-if="fieldPairs.length" class="muted">
        {{ fieldPairs.length }} pair{{ fieldPairs.length === 1 ? '' : 's' }} don't line up by name ·
      </span>
      <button class="link" @click="emit('fields')">edit</button>
    </p>

    <div v-if="tab === 'conflict'">
      <p v-if="!conflicts.length" class="muted">{{ filtering ? 'No conflicts match the filter.' : 'No conflicts.' }}</p>
      <div v-else class="split">
        <ol class="note-list">
          <li
            v-for="(e, i) in conflicts"
            :key="e.guid"
            :class="[{ on: i === current }, state.resolutions[e.guid].status]"
            @click="current = i"
          >
            <span class="icon">{{ STATUS_ICON[state.resolutions[e.guid].status] }}</span>
            <span v-if="e.sharedWith.length || e.ambiguous" class="warn-text" :title="warnTitle(e)">⚠ </span>{{ label(e) }}
          </li>
        </ol>
        <ConflictMerge
          :key="conflicts[current].guid"
          :entry="conflicts[current]"
          :index="current"
          :total="conflicts.length"
          @prev="move(-1)"
          @next="move(1)"
          @fields="emit('fields', $event)"
        />
      </div>
    </div>

    <div v-else-if="tab === 'auto'" class="card">
      <div class="row bulk">
        <span class="muted small">
          Only empty library fields are filled and new tags added; nothing existing is overwritten.
          <b>{{ acceptedAutos }} of {{ autos.length }} accepted.</b>
        </span>
        <button :disabled="acceptedAutos === autos.length" @click="acceptAll('auto', scope(autos))">
          Accept all{{ filtering ? ' shown' : '' }} ({{ autos.length }})
        </button>
        <button :disabled="!acceptedAutos" @click="clearAll('auto', scope(autos))">Clear</button>
      </div>
      <table class="plain">
        <thead><tr><th>Accept</th><th>Note</th><th>Fills</th><th>New tags</th></tr></thead>
        <tbody>
          <tr v-for="e in autos" :key="e.guid" :class="{ pending: !isAccepted(e) }">
            <td><input type="checkbox" :checked="isAccepted(e)" :aria-label="`Accept ${label(e)}`" @change="toggle(e)" /></td>
            <td>
              <span v-if="e.sharedWith.length || e.ambiguous" class="warn-text" :title="warnTitle(e)">⚠ </span>{{ label(e) }}
              <span v-if="e.crossType" class="badge" title="Merged into a note of another type, chosen under Possible duplicates">into {{ e.libNote.modelName }}</span>
            </td>
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
      <div class="row bulk">
        <span class="muted small">
          <template v-if="state.deckMode === 'package'">Each note is added to the deck it has in the package.</template>
          <template v-else>Added to deck <b>{{ state.targetDeck }}</b>.</template>
          <b>{{ acceptedNews }} of {{ news.length }} accepted.</b>
        </span>
        <button :disabled="acceptedNews === news.length" @click="acceptAll('new', scope(news))">
          Accept all{{ filtering ? ' shown' : '' }} ({{ news.length }})
        </button>
        <button :disabled="!acceptedNews" @click="clearAll('new', scope(news))">Clear</button>
      </div>
      <table class="plain">
        <thead><tr><th>Accept</th><th>Note</th><th>Note type</th><th>Deck</th><th>Tags</th></tr></thead>
        <tbody>
          <tr v-for="e in news" :key="e.guid" :class="{ pending: !isAccepted(e) }">
            <td><input type="checkbox" :checked="isAccepted(e)" :aria-label="`Accept ${label(e)}`" @change="toggle(e)" /></td>
            <td>{{ label(e) }}</td>
            <td class="small">{{ e.target.modelName }}<span v-if="e.target.create" class="badge">new</span></td>
            <td class="small">{{ deckOf(e) }}</td>
            <td class="small">{{ e.pkgNote.tags.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="tab === 'duplicate'" class="card">
      <div class="row bulk">
        <span class="muted small">
          These package notes found no match in the note type they map to, but their {{ settings.mainField }} already exists
          in another note type. Adding them would create a duplicate. Decide each one: add it anyway, leave it out, or merge
          it into the existing note. Undecided ones aren't written.
          <b>{{ decidedDuplicates }} of {{ duplicates.length }} decided.</b>
        </span>
        <label class="toggle small"><input v-model="undecidedOnly" type="checkbox" /> Undecided only</label>
        <button :disabled="decidedDuplicates === duplicates.length" @click="decideAllDuplicates('skip', scope(duplicates))">
          Don't add the undecided
        </button>
        <button :disabled="decidedDuplicates === duplicates.length" @click="decideAllDuplicates('add', scope(duplicates))">
          Add the undecided
        </button>
      </div>
      <p v-if="!duplicates.length" class="muted">
        {{ filtering ? 'No possible duplicates match the filter.' : 'No possible duplicates: every match is in the note type it maps to.' }}
      </p>
      <table v-else class="plain dups">
        <thead><tr><th>Package note</th><th>Already in your library</th><th>Decision</th></tr></thead>
        <tbody>
          <!-- Dimmed once left out; undecided rows stay at full strength, since they still need a decision. -->
          <tr v-for="e in shownDuplicates" :key="e.guid" :class="{ pending: dupDecision(e) === 'skip' }">
            <td>
              <!-- Same shape as the library notes' header: note type in bold, then what identifies the note. -->
              <b>{{ e.notetype.name }}</b> <span class="muted small">·</span> {{ label(e) }}
              <dl class="field-lines small">
                <div v-for="f in fieldLines(e.pkgFields)" :key="f.name"><dt>{{ f.name }}</dt><dd>{{ f.text }}</dd></div>
              </dl>
              <MediaStrip :html="mediaHtml(e.pkgFields)" source="pkg" lazy />
            </td>
            <td>
              <div v-for="n in othersOf(e)" :key="n.id" class="other" :class="{ on: e.crossType && e.libNote.id === n.id }">
                <b>{{ n.modelName }}</b> <span class="muted small">· note {{ n.id }}</span>
                <dl class="field-lines small">
                  <div v-for="f in fieldLines(n.fields)" :key="f.name"><dt>{{ f.name }}</dt><dd>{{ f.text }}</dd></div>
                </dl>
                <MediaStrip :html="mediaHtml(n.fields)" source="lib" lazy />
                <button class="link small" @click="openInAnki(n.id)">Open in Anki</button>
                <span v-if="e.crossType && e.libNote.id === n.id" class="small ok-text">
                  · merging into this note ({{ e.kind === 'conflict' ? 'accept it under Conflicts' : e.kind === 'auto' ? 'accepted under Auto-merges' : 'nothing differs' }})
                  · <button class="link small" @click="checkPair(e)">check the {{ e.notetype.name }} → {{ n.modelName }} field mapping</button>
                </span>
                <button v-else class="link small" @click="decideDuplicate(e.guid, 'merge', n.id)">· Merge into this note</button>
              </div>
            </td>
            <td class="decide">
              <button :class="{ on: dupDecision(e) === 'add' }" :title="`Add as a new ${e.target.modelName} note`" @click="decideDuplicate(e.guid, 'add')">
                Add as new
              </button>
              <button :class="{ on: dupDecision(e) === 'skip' }" @click="decideDuplicate(e.guid, 'skip')">Don't add</button>
              <button v-if="dupDecision(e)" class="link small" @click="decideDuplicate(e.guid, null)">undo</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else>
      <p v-if="!mergedEntries.length" class="muted">{{ filtering ? 'No merged notes match the filter.' : 'Nothing has been merged yet.' }}</p>
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
.bulk { margin-bottom: 8px; }
.bulk span { flex: 1; }
.accept-all { margin-left: auto; }
table.dups td { vertical-align: top; }
.dups .other + .other { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.dups .other.on { background: var(--fill-bg); box-shadow: inset 0 0 0 1px var(--accent); border-radius: 6px; padding: 4px 6px; }
.decide { white-space: nowrap; }
.pairings { border-color: var(--warn); }
.pairings p { margin: 0 0 6px; }
.pairings ul { margin: 0; padding-left: 18px; }
.field-lines { margin: 4px 0 0; }
.field-lines dt { display: inline; font-weight: 600; color: var(--muted); }
.field-lines dt::after { content: ': '; }
.field-lines dd { display: inline; margin: 0; }
.decide button.on { background: var(--fill-bg); box-shadow: inset 0 0 0 1px var(--accent); font-weight: 600; }
</style>
