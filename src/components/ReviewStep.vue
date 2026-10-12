<script setup>
import { computed, ref } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel } from '../lib/display.js'
import ConflictMerge from './ConflictMerge.vue'

const emit = defineEmits(['done'])
const { state, settings, counts } = useMergeSession()

const tab = ref(counts.value.conflict ? 'conflict' : 'auto')
const current = ref(0)

const byKind = (kind) => state.entries.filter((e) => e.kind === kind)
const conflicts = computed(() => byKind('conflict'))
const autos = computed(() => byKind('auto'))
const news = computed(() => byKind('new'))

const decided = computed(() => conflicts.value.filter((e) => state.resolutions[e.guid].status !== 'pending').length)
const STATUS_ICON = { pending: '○', accepted: '✓', skipped: '–' }

const label = (e) => entryLabel(e, settings.mainField)
const included = (e) => !state.excluded.has(e.guid)
function toggle(e) {
  if (state.excluded.has(e.guid)) state.excluded.delete(e.guid)
  else state.excluded.add(e.guid)
}

const move = (delta) => {
  current.value = Math.min(conflicts.value.length - 1, Math.max(0, current.value + delta))
}
</script>

<template>
  <section>
    <h2>Review</h2>
    <div class="stats">
      <button :class="{ on: tab === 'conflict' }" @click="tab = 'conflict'">
        <b>{{ counts.conflict }}</b> conflicts <small>{{ decided }} decided</small>
      </button>
      <button :class="{ on: tab === 'auto' }" @click="tab = 'auto'"><b>{{ counts.auto }}</b> auto-merges</button>
      <button :class="{ on: tab === 'new' }" @click="tab = 'new'"><b>{{ counts.new }}</b> new notes</button>
      <div><b>{{ counts.identical }}</b> identical</div>
    </div>
    <p v-if="counts.shared" class="warn-text small">
      {{ counts.shared }} package notes share a library note with another package note (marked ⚠). Where they want
      different values for a field, applying is blocked until you skip one or make them agree.
    </p>
    <p v-if="counts.ambiguous" class="warn-text small">
      {{ counts.ambiguous }} note(s) matched more than one library note by main field; the first match is used.
    </p>

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

    <div v-else class="card">
      <p class="muted small">Added to deck <b>{{ state.targetDeck }}</b>.</p>
      <table class="plain">
        <thead><tr><th></th><th>Note</th><th>Note type</th><th>Tags</th></tr></thead>
        <tbody>
          <tr v-for="e in news" :key="e.guid" :class="{ excluded: !included(e) }">
            <td><input type="checkbox" :checked="included(e)" @change="toggle(e)" /></td>
            <td>{{ label(e) }}</td>
            <td class="small">{{ e.target.modelName }}<span v-if="e.target.create" class="badge">new</span></td>
            <td class="small">{{ e.pkgNote.tags.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <button class="primary" @click="emit('done')">Continue to apply →</button>
  </section>
</template>
