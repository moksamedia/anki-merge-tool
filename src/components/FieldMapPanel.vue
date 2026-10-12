<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { unmappedFields } from '../lib/fieldMap.js'
import FieldMapTable from './FieldMapTable.vue'

// Collapsed by default: fields pair by name unless the user opens this and
// chooses otherwise. Lists every pair the analysis writes through that doesn't
// line up, including library types reached only by library-wide matching.
const { fieldPairs, fieldMapOf } = useMergeSession()

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const unmappedCount = computed(() =>
  fieldPairs.value.reduce((n, p) => n + unmappedFields(p.notetype.fields, fieldMapOf(p)).length, 0),
)
</script>

<template>
  <details v-if="fieldPairs.length" class="card field-maps">
    <summary>
      <b>Field mapping</b>
      <span class="muted small">
        · {{ plural(fieldPairs.length, 'note type pair') }} don't line up; fields are paired by name
      </span>
      <span v-if="unmappedCount" class="warn-text small"> · {{ plural(unmappedCount, 'package field') }} not imported</span>
    </summary>
    <p class="muted small">
      Choose which package field fills each library field. Same-named fields are paired automatically; choices are
      remembered for the next package with the same note types.
    </p>

    <div v-for="pair in fieldPairs" :key="pair.key" class="pair">
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
  </details>
</template>
