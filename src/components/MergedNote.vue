<script setup>
import { computed, ref } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { entryLabel } from '../lib/display.js'
import { normalizeValue } from '../lib/match.js'
import FieldPreview from './FieldPreview.vue'
import MediaStrip from './MediaStrip.vue'

// A package note an earlier run wrote: what was written, read-only.
const props = defineProps({
  entry: { type: Object, required: true },
})

const { state, settings } = useMergeSession()
const rendered = ref(true)

const merged = computed(() => state.merged[props.entry.guid])
const KIND_LABEL = { new: 'added', auto: 'auto-merged', conflict: 'merged after review' }
const when = computed(() => (merged.value.at ? new Date(merged.value.at).toLocaleString() : ''))

// Only an analysis run after the merge says anything about the library since then.
const reanalyzed = computed(() => !!state.analyzedAt && !!merged.value.at && state.analyzedAt > merged.value.at)
const gone = computed(() => reanalyzed.value && merged.value.libNoteId != null && !props.entry.libNote)

const libNow = (name) => props.entry.libNote?.fields?.[name]
const changedSince = (name) =>
  reanalyzed.value && !!props.entry.libNote && normalizeValue(libNow(name) ?? '') !== normalizeValue(merged.value.fields[name] ?? '')

const fields = computed(() => Object.entries(merged.value.fields ?? {}))
</script>

<template>
  <div class="merge">
    <header class="merge-head">
      <div>
        <h3>{{ entryLabel(entry, settings.mainField) }}</h3>
        <span class="badge accepted">✔ {{ KIND_LABEL[merged.kind] ?? 'merged' }}</span>
        <span class="badge">run {{ merged.run }} · {{ when }}</span>
        <span v-if="merged.modelName" class="badge">{{ merged.modelName }}</span>
        <span v-if="merged.deck" class="badge">{{ merged.deck }}</span>
        <span v-if="merged.libNoteId != null" class="badge">note {{ merged.libNoteId }}</span>
        <span v-if="gone" class="badge warn">no longer in the library</span>
      </div>
      <div class="row">
        <label class="toggle"><input v-model="rendered" type="checkbox" /> Rendered</label>
      </div>
    </header>

    <p class="muted small">
      Already written to the library; it won't be merged again. Change it in Anki if it needs more work.
    </p>

    <table v-if="fields.length" class="fields merged">
      <thead>
        <tr><th>Field</th><th>Written</th></tr>
      </thead>
      <tbody>
        <tr v-for="[name, value] in fields" :key="name">
          <th>
            <template v-for="(part, i) in name.split(/(?<=_)/)" :key="i">{{ part }}<wbr /></template>
          </th>
          <td>
            <FieldPreview v-if="rendered" :html="value" source="result" />
            <template v-else>
              <div class="raw">{{ value || '' }}<span v-if="!value" class="empty">(empty)</span></div>
              <MediaStrip :html="value" source="result" />
            </template>
            <p v-if="changedSince(name)" class="warn-text small since">
              Changed in Anki since the merge. Now:
              <span class="raw">{{ libNow(name) || '(empty)' }}</span>
            </p>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">No fields were written (tags only).</p>
    <p v-if="merged.tags?.length" class="muted">Tags added: {{ merged.tags.join(', ') }}</p>
  </div>
</template>

<style scoped>
table.merged thead th:first-child { width: 160px; }
.since { margin: 6px 0 0; }
</style>
