<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { sameNamedField, unmappedFields } from '../lib/fieldMap.js'
import { plainText } from '../lib/display.js'

// Collapsed by default: fields pair by name unless the user opens this and
// chooses otherwise. Only pairs whose note types don't line up are listed.
const { state, fieldPairs, setFieldMap, resetFieldMap } = useMergeSession()

const mapOf = (pair) => state.fieldMaps[pair.key]
/** Row status: paired by same name, mapped by hand to a differently named field, or fed by nothing. */
function rowStatus(pair, lib) {
  const pkg = mapOf(pair)[lib]
  if (!pkg) return 'none'
  return pkg === sameNamedField(pair.notetype.fields, lib) ? 'same' : 'manual'
}
const STATUS_TEXT = { same: 'same name', manual: 'different name', none: 'no match' }
const unmapped = (pair) => unmappedFields(pair.notetype.fields, mapOf(pair))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const unmappedCount = computed(() => fieldPairs.value.reduce((n, p) => n + unmapped(p).length, 0))

/** A short example of what the chosen package field holds, from the first note that has it. */
function example(pair, lib) {
  const pkg = mapOf(pair)[lib]
  if (!pkg) return ''
  const text = plainText(pair.samples.map((f) => f[pkg]).find((v) => plainText(v)))
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
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
        <button class="link small" @click="resetFieldMap(pair)">Reset to matching names</button>
      </div>
      <table class="plain map">
        <thead><tr><th>Library field</th><th>Filled from package field</th><th>Example</th></tr></thead>
        <tbody>
          <tr v-for="lib in pair.libFields" :key="lib" :class="`map-${rowStatus(pair, lib)}`">
            <td>{{ lib }}</td>
            <td>
              <select
                :value="mapOf(pair)[lib]"
                :aria-label="`Package field for ${lib}`"
                @change="setFieldMap(pair, lib, $event.target.value)"
              >
                <option value="">(nothing)</option>
                <option v-for="f in pair.notetype.fields" :key="f" :value="f">{{ f }}</option>
              </select>
              <span class="badge">{{ STATUS_TEXT[rowStatus(pair, lib)] }}</span>
            </td>
            <td class="small">{{ example(pair, lib) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="unmapped(pair).length" class="warn-text small">
        Not imported (no library field takes them): {{ unmapped(pair).join(', ') }}
      </p>
    </div>
  </details>
</template>
