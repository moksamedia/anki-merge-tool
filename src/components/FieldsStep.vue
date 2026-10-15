<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { savedPairKey, unmappedFields } from '../lib/fieldMap.js'
import FieldMapTable from './FieldMapTable.vue'

// Shown after analysis, when it's known which library note types the package
// notes go through: Configure's targets, plus types reached by library-wide
// matching. Fields pair by name unless changed here.
const emit = defineEmits(['done'])
const { settings, fieldPairs, fieldMapOf } = useMergeSession()

// Each pair's table starts collapsed; which ones are open is remembered by
// note type names, so it carries over to later sessions and packages.
const nameKey = (pair) => savedPairKey(pair.notetype.name, pair.modelName)
const isOpen = (pair) => settings.openFieldPairs.includes(nameKey(pair))
function onToggle(pair, open) {
  if (open === isOpen(pair)) return
  const key = nameKey(pair)
  settings.openFieldPairs = open ? [...settings.openFieldPairs, key] : settings.openFieldPairs.filter((k) => k !== key)
}

const configured = computed(() => fieldPairs.value.filter((p) => p.configured))
const others = computed(() => fieldPairs.value.filter((p) => !p.configured))

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const unmappedOf = (pair) => unmappedFields(pair.notetype.fields, fieldMapOf(pair))
const unmappedCount = computed(() => fieldPairs.value.reduce((n, p) => n + unmappedOf(p).length, 0))
</script>

<template>
  <section>
    <h2>Fields</h2>
    <template v-if="fieldPairs.length">
      <p class="muted small">
        {{ plural(fieldPairs.length, 'note type pair') }} don't line up by field name.
        <span v-if="unmappedCount" class="warn-text">{{ plural(unmappedCount, 'package field') }} not imported.</span>
        Choose which package field fills each library field; same-named fields are paired automatically. Choices are
        remembered for the next package with the same note types, and Review updates as you change them.
      </p>

      <div v-if="configured.length" class="card">
        <h3>Set in Configure</h3>
        <p class="muted small">Each package note type and the library note type you chose for it, where its new notes go.</p>
        <details
          v-for="pair in configured"
          :key="pair.key"
          class="pair"
          :open="isOpen(pair)"
          @toggle="onToggle(pair, $event.target.open)"
        >
          <summary class="map-head">
            <h3>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h3>
            <span class="muted small">
              <template v-if="pair.matched">{{ plural(pair.matched, 'matched note') }}</template>
              <template v-if="pair.matched && pair.added"> · </template>
              <template v-if="pair.added">{{ plural(pair.added, 'new note') }}</template>
              <template v-if="unmappedOf(pair).length"> · </template>
            </span>
            <span v-if="unmappedOf(pair).length" class="warn-text small">not imported: {{ unmappedOf(pair).join(', ') }}</span>
          </summary>
          <FieldMapTable :pair="pair" />
        </details>
      </div>

      <div v-if="others.length" class="card">
        <h3>Matched into other note types</h3>
        <p class="muted small">
          Matching by main field found package notes that already exist in your library under another note type. They're
          compared and filled through these maps; new notes never go here.
        </p>
        <details
          v-for="pair in others"
          :key="pair.key"
          class="pair"
          :open="isOpen(pair)"
          @toggle="onToggle(pair, $event.target.open)"
        >
          <summary class="map-head">
            <h3>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h3>
            <span class="muted small">
              {{ plural(pair.matched, 'matched note') }}<template v-if="unmappedOf(pair).length"> · </template>
            </span>
            <span v-if="unmappedOf(pair).length" class="warn-text small">not imported: {{ unmappedOf(pair).join(', ') }}</span>
          </summary>
          <FieldMapTable :pair="pair" />
        </details>
      </div>
    </template>
    <p v-else class="muted">Every note type lines up; fields pair by name.</p>

    <button class="primary" @click="emit('done')">Continue to review →</button>
  </section>
</template>

<style scoped>
summary.map-head { cursor: pointer; list-style: none; }
summary.map-head::-webkit-details-marker { display: none; }
summary.map-head h3::before { content: '▸'; display: inline-block; width: 1em; color: var(--muted); }
details[open] > summary.map-head h3::before { content: '▾'; }
details[open] > summary.map-head { margin-bottom: 8px; }
</style>
