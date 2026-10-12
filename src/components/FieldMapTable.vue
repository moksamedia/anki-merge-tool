<script setup>
import { useMergeSession } from '../composables/useMergeSession.js'
import { sameNamedField, unmappedFields } from '../lib/fieldMap.js'
import { plainText } from '../lib/display.js'

// One pair's field map: {key, notetype, modelName, libFields, samples: [pkgFields]}.
const props = defineProps({ pair: { type: Object, required: true } })

const { fieldMapOf, setFieldMap, resetFieldMap } = useMergeSession()

const mapOf = () => fieldMapOf(props.pair)
const unmapped = () => unmappedFields(props.pair.notetype.fields, mapOf())

/** Row status: paired by same name, mapped by hand to a differently named field, or fed by nothing. */
function rowStatus(lib) {
  const pkg = mapOf()[lib]
  if (!pkg) return 'none'
  return pkg === sameNamedField(props.pair.notetype.fields, lib) ? 'same' : 'manual'
}
const STATUS_TEXT = { same: 'same name', manual: 'different name', none: 'no match' }

/** A short example of what the chosen package field holds, from the first note that has it. */
function example(lib) {
  const pkg = mapOf()[lib]
  if (!pkg) return ''
  const text = plainText(props.pair.samples.map((f) => f[pkg]).find((v) => plainText(v)))
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
</script>

<template>
  <table class="plain map">
    <thead><tr><th>Library field</th><th>Filled from package field</th><th>Example</th></tr></thead>
    <tbody>
      <tr v-for="lib in pair.libFields" :key="lib" :class="`map-${rowStatus(lib)}`">
        <td>{{ lib }}</td>
        <td>
          <select :value="mapOf()[lib]" :aria-label="`Package field for ${lib}`" @change="setFieldMap(pair, lib, $event.target.value)">
            <option value="">(nothing)</option>
            <option v-for="f in pair.notetype.fields" :key="f" :value="f">{{ f }}</option>
          </select>
          <span class="badge">{{ STATUS_TEXT[rowStatus(lib)] }}</span>
        </td>
        <td class="small">{{ example(lib) }}</td>
      </tr>
    </tbody>
  </table>
  <div class="row small map-foot">
    <span v-if="unmapped().length" class="warn-text">Not imported (no library field takes them): {{ unmapped().join(', ') }}</span>
    <button class="link small" @click="resetFieldMap(pair)">Reset to matching names</button>
  </div>
</template>
