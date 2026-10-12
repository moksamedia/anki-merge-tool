<script setup>
import { computed, ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'

const emit = defineEmits(['done', 'resume'])
const { state, openPackage, resumeSession, runAnalysis, peekSessions, forgetRecent } = useMergeSession()

const baseName = (path) => path.split(/[\\/]/).pop()
const dirName = (path) => path.slice(0, path.length - baseName(path).length - 1)
const fileName = computed(() => state.pkgPath && baseName(state.pkgPath))
const notesPerType = computed(() => {
  const counts = new Map()
  for (const n of state.pkg?.notes ?? []) counts.set(n.notetypeId, (counts.get(n.notetypeId) ?? 0) + 1)
  return counts
})

// Saved sessions next to the recent packages: {path: summary}.
const sessions = ref({})
watch(
  () => [state.recentPackages, state.session.savedAt],
  async () => (sessions.value = await peekSessions(state.recentPackages)),
  { immediate: true, deep: true },
)

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '')
function summaryText(s) {
  const parts = []
  if (s.merged) parts.push(`${s.merged} merged`)
  if (s.accepted) parts.push(`${s.accepted} accepted`)
  if (s.decided) parts.push(`${s.decided} decided`)
  if (s.pending) parts.push(`${s.pending} undecided`)
  return parts.join(' · ') || 'started'
}

// The open package's own saved session, before analysis has run.
const openSession = computed(() =>
  state.pkg && state.session.restored && !state.entries.length ? sessions.value[state.pkgPath] : null,
)

/** Open a recent package by path, or (no path) pick one in the file dialog. */
async function choose(path) {
  await openPackage(path)
  if (state.pkg && !state.error) emit('done')
}

/** Open a package with a saved session and go straight to Review. */
async function resume(path) {
  if (await resumeSession(path)) emit('resume')
}

/** The open package: analyze with the restored choices and go to Review. */
async function resumeOpen() {
  await runAnalysis()
  if (state.entries.length && !state.error) emit('resume')
}
</script>

<template>
  <section>
    <h2>Open a package</h2>
    <button class="primary" :disabled="state.busy" @click="choose()">Choose .apkg file…</button>

    <div v-if="state.recentPackages.length" class="recent">
      <h3>Recent</h3>
      <ul>
        <li v-for="path in state.recentPackages" :key="path">
          <button class="link" :disabled="state.busy" :title="path" @click="choose(path)">{{ baseName(path) }}</button>
          <span class="muted small">{{ dirName(path) }}</span>
          <template v-if="sessions[path]">
            <span class="badge session" :title="`Session saved ${when(sessions[path].savedAt)}`">
              {{ summaryText(sessions[path]) }}
            </span>
            <button class="link small" :disabled="state.busy" @click="resume(path)">Resume →</button>
          </template>
          <span v-if="path === state.pkgPath" class="badge">open</span>
          <button class="link small forget" :title="`Remove ${baseName(path)} from recent`" @click="forgetRecent(path)">
            ×
          </button>
        </li>
      </ul>
    </div>

    <div v-if="state.pkg" class="card">
      <h3>{{ fileName }}</h3>
      <p class="muted">
        Format <code>{{ state.pkg.format }}</code> · {{ state.pkg.notes.length }} notes · {{ state.pkg.media.length }} media
        files
      </p>
      <p v-if="openSession" class="session-note">
        A saved merge session from {{ when(openSession.savedAt) }} was restored: {{ summaryText(openSession) }}.
        <button class="link" :disabled="state.busy" @click="resumeOpen">Analyze and resume the review →</button>
      </p>
      <table class="plain">
        <thead><tr><th>Note type</th><th>Fields</th><th>Notes</th></tr></thead>
        <tbody>
          <tr v-for="nt in state.pkg.notetypes.filter((t) => notesPerType.get(t.id))" :key="nt.id">
            <td>{{ nt.name }}<span v-if="nt.isCloze" class="badge">cloze</span></td>
            <td class="muted">{{ nt.fields.join(', ') }}</td>
            <td>{{ notesPerType.get(nt.id) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">Decks: {{ state.pkg.decks.map((d) => d.name).join(', ') }}</p>
    </div>
  </section>
</template>

<style scoped>
.badge.session { color: var(--ok); border-color: var(--ok); white-space: nowrap; }
.session-note { padding: 8px 12px; border-radius: 6px; background: var(--fill-bg); }
</style>
