<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { unmappedFields } from '../lib/fieldMap.js'
import FieldMapTable from './FieldMapTable.vue'

// Shown after analysis, when it's known which library note types the package
// notes go through: Configure's targets, plus types reached by library-wide
// matching. Fields pair by name unless changed here.
const emit = defineEmits(['done'])
const { fieldPairs, fieldMapOf } = useMergeSession()

const configured = computed(() => fieldPairs.value.filter((p) => p.configured))
const others = computed(() => fieldPairs.value.filter((p) => !p.configured))

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const unmappedCount = computed(() =>
  fieldPairs.value.reduce((n, p) => n + unmappedFields(p.notetype.fields, fieldMapOf(p)).length, 0),
)
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
        <div v-for="pair in configured" :key="pair.key" class="pair">
          <div class="map-head">
            <h3>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h3>
            <span class="muted small">
              <template v-if="pair.matched">{{ plural(pair.matched, 'matched note') }}</template>
              <template v-if="pair.matched && pair.added"> · </template>
              <template v-if="pair.added">{{ plural(pair.added, 'new note') }}</template>
            </span>
          </div>
          <FieldMapTable :pair="pair" />
        </div>
      </div>

      <div v-if="others.length" class="card">
        <h3>Matched into other note types</h3>
        <p class="muted small">
          Matching by main field found package notes that already exist in your library under another note type. They're
          compared and filled through these maps; new notes never go here.
        </p>
        <div v-for="pair in others" :key="pair.key" class="pair">
          <div class="map-head">
            <h3>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h3>
            <span class="muted small">{{ plural(pair.matched, 'matched note') }}</span>
          </div>
          <FieldMapTable :pair="pair" />
        </div>
      </div>
    </template>
    <p v-else class="muted">Every note type lines up; fields pair by name.</p>

    <button class="primary" @click="emit('done')">Continue to review →</button>
  </section>
</template>
