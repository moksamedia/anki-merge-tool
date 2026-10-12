<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'

const emit = defineEmits(['done'])
const { state, openPackage, forgetRecent } = useMergeSession()

const baseName = (path) => path.split(/[\\/]/).pop()
const dirName = (path) => path.slice(0, path.length - baseName(path).length - 1)
const fileName = computed(() => state.pkgPath && baseName(state.pkgPath))
const notesPerType = computed(() => {
  const counts = new Map()
  for (const n of state.pkg?.notes ?? []) counts.set(n.notetypeId, (counts.get(n.notetypeId) ?? 0) + 1)
  return counts
})

/** Open a recent package by path, or (no path) pick one in the file dialog. */
async function choose(path) {
  await openPackage(path)
  if (state.pkg && !state.error) emit('done')
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
