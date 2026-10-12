<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'

const emit = defineEmits(['done', 'back'])
const { state, dryRun, copyDryRun, saveDryRun } = useMergeSession()

onMounted(() => (state.previewed = true))

const r = dryRun
const notice = ref('')
const showRaw = ref(false)
const query = ref('')
const PAGE = 100
const limits = reactive({ updates: PAGE, newNotes: PAGE, skipped: PAGE })

const REASON = { fill: 'fills empty field', package: 'package value', edited: 'edited in review' }
const SKIP_REASON = {
  undecided: 'conflict not decided',
  skipped: 'conflict skipped',
  'not accepted': 'not accepted in review',
  'no change': 'accepted, but nothing differs',
  merged: 'already merged in an earlier run',
}
const WARNING_LABEL = { ambiguous: 'Ambiguous match', shared: 'Shares a library note', dropped: 'Content not merged' }

function flash(message) {
  notice.value = message
  setTimeout(() => notice.value === message && (notice.value = ''), 4000)
}

async function copy() {
  try {
    await copyDryRun()
    flash('Copied the JSON report to the clipboard.')
  } catch (e) {
    state.error = `Copy failed: ${e}`
  }
}

async function saveFile() {
  try {
    const path = await saveDryRun()
    if (path) flash(`Saved ${path}`)
  } catch (e) {
    state.error = `Save failed: ${e}`
  }
}

const matches = (...values) => {
  const q = query.value.trim().toLowerCase()
  return !q || values.some((v) => String(v ?? '').toLowerCase().includes(q))
}
const updates = computed(() => r.value.updates.filter((u) => matches(u.label, u.noteType, ...u.changes.map((c) => c.field))))
const newNotes = computed(() => r.value.newNotes.filter((n) => matches(n.label, n.deck, n.noteType, ...n.tags)))
const skipped = computed(() => r.value.skipped.filter((s) => matches(s.label, s.reason)))

const tiles = computed(() => {
  const s = r.value.summary
  return [
    { label: 'New notes', value: s.notesAdded },
    { label: 'Notes updated', value: s.notesUpdated },
    { label: 'Fields changed', value: s.fieldsChanged },
    { label: 'Notes tagged', value: s.notesTagged },
    { label: 'Decks created', value: s.decksCreated },
    { label: 'Note types created', value: s.noteTypesCreated },
    { label: 'Fields added', value: s.fieldsCreated },
    { label: 'Media files', value: s.mediaFiles },
    { label: 'Left alone', value: r.value.skipped.length },
    {
      label: 'Not accepted',
      value: s.notAccepted.new + s.notAccepted.auto,
      warn: s.notAccepted.new + s.notAccepted.auto > 0,
    },
    { label: 'Already merged', value: s.alreadyMerged },
    { label: 'Already identical', value: s.unchanged },
    { label: 'Warnings', value: s.warnings, warn: s.warnings > 0 },
    { label: 'Collisions', value: s.collisions, error: s.collisions > 0 },
  ]
})

const rawJson = computed(() => (showRaw.value ? JSON.stringify(r.value, null, 2) : ''))
const generated = computed(() => new Date(r.value.generatedAt).toLocaleString())
</script>

<template>
  <section v-if="r" class="preview-step">
    <header class="row spread">
      <div>
        <h2>Preview (dry run)</h2>
        <p class="muted small">
          Nothing has been written. This is exactly what <b>Back up &amp; merge</b> would do with the current decisions —
          {{ r.package.file }}, generated {{ generated }}.
        </p>
      </div>
      <div class="row">
        <button @click="copy">Copy JSON</button>
        <button @click="saveFile">Save JSON…</button>
        <button :class="{ on: showRaw }" @click="showRaw = !showRaw">{{ showRaw ? 'Hide' : 'Show' }} raw JSON</button>
      </div>
    </header>
    <p v-if="notice" class="ok-text small" role="status">{{ notice }}</p>

    <div class="tiles">
      <div v-for="t in tiles" :key="t.label" class="tile" :class="{ warn: t.warn, bad: t.error }">
        <b>{{ t.value }}</b><span>{{ t.label }}</span>
      </div>
    </div>

    <div v-if="r.collisions.length" class="error">
      <b>{{ r.collisions.length }} field(s) where package notes disagree about the same library note.</b>
      Apply is blocked until you resolve them in Review.
      <ul class="small">
        <li v-for="c in r.collisions" :key="`${c.libNoteId}-${c.field}`">
          note {{ c.libNoteId }} · {{ c.field }}:
          <span v-for="(v, i) in c.values" :key="v.guid">{{ i ? ' vs ' : '' }}<b>{{ v.label }}</b> <code>{{ v.value || '(empty)' }}</code></span>
        </li>
      </ul>
    </div>

    <div v-if="showRaw" class="card">
      <h3>Raw JSON</h3>
      <pre class="raw-json">{{ rawJson }}</pre>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>What will happen, in order</h3>
        <ol class="steps-list">
          <li v-for="s in r.steps" :key="s">{{ s }}</li>
        </ol>
      </div>
      <div class="card">
        <h3>Settings</h3>
        <dl class="kv small">
          <dt>Main field</dt><dd>{{ r.settings.mainField || '(first field)' }}</dd>
          <dt>GUIDs</dt><dd>{{ r.settings.ignoreGuid ? 'ignored' : 'matched first' }}</dd>
          <dt>Empty fields</dt><dd>{{ r.settings.autoFillEmpty ? 'filled automatically' : 'reviewed as conflicts' }}</dd>
          <dt>New notes go to</dt>
          <dd>{{ r.decks.mode === 'package' ? "each note's package deck" : r.decks.target }}</dd>
          <dt>Merge tag</dt><dd><code v-if="r.mergeTag">{{ r.mergeTag }}</code><span v-else>none</span></dd>
          <dt>Conflicts</dt>
          <dd>
            {{ r.summary.conflicts.accepted }} accepted · {{ r.summary.conflicts.skipped }} skipped ·
            <span :class="{ 'warn-text': r.summary.conflicts.undecided }">{{ r.summary.conflicts.undecided }} undecided</span>
          </dd>
        </dl>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Decks for new notes</h3>
        <p v-if="!r.decks.used.length" class="muted small">No new notes.</p>
        <table v-else class="plain small">
          <thead><tr><th>Deck</th><th>New notes</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in r.decks.used" :key="d.name">
              <td>{{ d.name }}</td>
              <td>{{ d.newNotes }}</td>
              <td><span v-if="!d.exists" class="badge warn">will be created</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Note types</h3>
        <table class="plain small">
          <thead><tr><th>Package</th><th>Library</th><th>Notes</th></tr></thead>
          <tbody>
            <tr v-for="t in r.noteTypes.targets" :key="t.package">
              <td>{{ t.package }}</td>
              <td>{{ t.library }} <span v-if="t.create" class="badge">created</span></td>
              <td>{{ t.notes }}</td>
            </tr>
          </tbody>
        </table>
        <div v-for="m in r.noteTypes.create" :key="m.name" class="small sub">
          <b>Create “{{ m.name }}”</b><span v-if="m.cloze" class="badge">cloze</span> — fields: {{ m.fields.join(', ') }} ·
          templates: {{ m.templates.join(', ') }}
        </div>
        <div v-if="r.noteTypes.addFields.length" class="small sub">
          <b>Fields added to library note types:</b>
          <span v-for="(f, i) in r.noteTypes.addFields" :key="`${f.modelName}-${f.fieldName}`">
            {{ i ? ', ' : ' ' }}“{{ f.fieldName }}” → {{ f.modelName }}
          </span>
        </div>
        <details v-for="m in r.noteTypes.fieldMaps" :key="`${m.package}-${m.library}`" class="small sub">
          <summary>Field map: {{ m.package }} → {{ m.library }}</summary>
          <table class="plain">
            <tbody>
              <tr v-for="(pkgField, libField) in m.fieldMap" :key="libField">
                <td>{{ pkgField || '—' }}</td><td>→</td><td>{{ libField }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="m.unmapped.length" class="warn-text">Not imported: {{ m.unmapped.join(', ') }}</p>
        </details>
      </div>
    </div>

    <div class="card">
      <h3>Media</h3>
      <p class="small">
        {{ r.media.length }} file(s) copied from the package — only those the written notes reference. A library file with
        the same name but different content is kept, and ours is stored under a new name.
      </p>
      <details v-if="r.media.length" class="small">
        <summary>List files</summary>
        <p class="media-list">{{ r.media.join(' · ') }}</p>
      </details>
    </div>

    <div class="row filter">
      <input v-model="query" type="search" placeholder="Filter notes by text, deck, note type, field, tag…" />
    </div>

    <div class="card">
      <h3>Updated notes <span class="muted">({{ updates.length }})</span></h3>
      <p v-if="!updates.length" class="muted small">None.</p>
      <details v-for="u in updates.slice(0, limits.updates)" :key="u.libNoteId" class="item">
        <summary>
          <b class="label">{{ u.label }}</b>
          <span class="muted small">{{ u.noteType }} · matched by {{ u.matchedBy === 'guid' ? 'GUID' : 'main field' }}</span>
          <span v-if="u.changes.length" class="badge">{{ u.changes.length }} field{{ u.changes.length === 1 ? '' : 's' }}</span>
          <span v-for="t in u.tagsAdded" :key="t" class="badge tag">+{{ t }}</span>
        </summary>
        <table v-if="u.changes.length" class="plain changes">
          <thead><tr><th>Field</th><th>Now</th><th>Will be</th><th>Why</th></tr></thead>
          <tbody>
            <tr v-for="c in u.changes" :key="c.field">
              <td>{{ c.field }}</td>
              <td><div class="clamp" :class="{ empty: !c.from }">{{ c.from || '(empty)' }}</div></td>
              <td><div class="clamp">{{ c.to || '(empty)' }}</div></td>
              <td class="small">{{ REASON[c.reason] }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted small">Tags only.</p>
        <p v-if="u.via.length > 1" class="muted small">From {{ u.via.length }} package notes merged into this one.</p>
      </details>
      <button v-if="updates.length > limits.updates" class="link" @click="limits.updates += PAGE * 5">
        Show more ({{ updates.length - limits.updates }} left)
      </button>
    </div>

    <div class="card">
      <h3>New notes <span class="muted">({{ newNotes.length }})</span></h3>
      <p v-if="!newNotes.length" class="muted small">None.</p>
      <details v-for="n in newNotes.slice(0, limits.newNotes)" :key="n.guid" class="item">
        <summary>
          <b class="label">{{ n.label }}</b>
          <span class="muted small">{{ n.noteType }} · {{ n.deck }}</span>
          <span v-for="t in n.tags" :key="t" class="badge tag">{{ t }}</span>
        </summary>
        <table class="plain changes">
          <tbody>
            <tr v-for="(value, field) in n.fields" :key="field">
              <td>{{ field }}</td>
              <td><div class="clamp" :class="{ empty: !value }">{{ value || '(empty)' }}</div></td>
            </tr>
          </tbody>
        </table>
      </details>
      <button v-if="newNotes.length > limits.newNotes" class="link" @click="limits.newNotes += PAGE * 5">
        Show more ({{ newNotes.length - limits.newNotes }} left)
      </button>
    </div>

    <div v-if="r.skipped.length" class="card">
      <h3>Left alone <span class="muted">({{ skipped.length }})</span></h3>
      <table class="plain small">
        <thead><tr><th>Note</th><th>Why</th></tr></thead>
        <tbody>
          <tr v-for="s in skipped.slice(0, limits.skipped)" :key="s.guid">
            <td>{{ s.label }}</td>
            <td :class="{ 'warn-text': s.reason === 'undecided' }">{{ SKIP_REASON[s.reason] ?? s.reason }}</td>
          </tr>
        </tbody>
      </table>
      <button v-if="skipped.length > limits.skipped" class="link" @click="limits.skipped += PAGE * 5">
        Show more ({{ skipped.length - limits.skipped }} left)
      </button>
    </div>

    <div v-if="r.warnings.length" class="card">
      <h3 class="warn-text">Warnings <span class="muted">({{ r.warnings.length }})</span></h3>
      <ul class="small">
        <li v-for="(w, i) in r.warnings" :key="i"><b>{{ WARNING_LABEL[w.kind] }}</b> · {{ w.label }} — {{ w.detail }}</li>
      </ul>
    </div>

    <footer class="row">
      <button @click="emit('back')">← Back to Review</button>
      <button class="primary" @click="emit('done')">Continue to Apply →</button>
    </footer>
  </section>
</template>

<style scoped>
.spread { justify-content: space-between; align-items: flex-start; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin: 12px 0; }
.tile {
  display: flex; flex-direction: column; gap: 2px; padding: 10px 12px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
}
.tile b { font-size: 20px; }
.tile span { font-size: 12px; color: var(--muted); }
.tile.warn { border-color: var(--warn); }
.tile.warn b { color: var(--warn); }
.tile.bad { border-color: var(--danger); }
.tile.bad b { color: var(--danger); }
.steps-list { margin: 0; padding-left: 20px; line-height: 1.7; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }
.sub { margin-top: 8px; }
.filter input { width: 100%; margin: 4px 0 12px; }
.item { border-top: 1px solid var(--border); padding: 6px 0; }
.item summary { cursor: pointer; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.item .label { font-size: 16px; }
.badge.tag { color: var(--accent); border-color: var(--accent); }
.changes { margin: 6px 0 4px; table-layout: fixed; }
.changes td:first-child { width: 140px; color: var(--muted); }
.clamp {
  font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word;
  max-height: 7.5em; overflow: auto;
}
.clamp.empty { color: var(--muted); font-style: italic; }
.raw-json {
  max-height: 60vh; overflow: auto; margin: 0; padding: 10px; font-size: 12px;
  background: var(--bg); border-radius: 6px; white-space: pre;
}
.media-list { word-break: break-all; }
footer { margin-top: 16px; }
footer button.primary { margin-top: 0; }
</style>
