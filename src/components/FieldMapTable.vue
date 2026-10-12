<script setup>
import { useMergeSession } from '../composables/useMergeSession.js'
import { sameNamedField, unmappedFields } from '../lib/fieldMap.js'
import { plainText } from '../lib/display.js'

// One pair's field map: {key, notetype, modelName, libFields, samples: [pkgFields]}.
const props = defineProps({ pair: { type: Object, required: true } })

const { state, fieldMapOf, setFieldMap, resetFieldMap, addLibraryField, removeLibraryField } = useMergeSession()

const mapOf = () => fieldMapOf(props.pair)
const unmapped = () => unmappedFields(props.pair.notetype.fields, mapOf())
const scheduled = () => state.newFields[props.pair.modelName] ?? []
const isNew = (lib) => scheduled().includes(lib)
// A package field can become a library field unless one with that name already exists.
const canAdd = (pkg) => !sameNamedField(props.pair.libFields, pkg)

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
    <thead>
      <tr>
        <th>Package field <span class="map-arrow" aria-hidden="true">→</span></th>
        <th>Library field</th>
        <th>Example</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="lib in pair.libFields" :key="lib" :class="`map-${rowStatus(lib)}`">
        <td>
          <select
            :value="mapOf()[lib]"
            :class="{ placeholder: !mapOf()[lib] }"
            :aria-label="`Package field that fills ${lib}`"
            @change="setFieldMap(pair, lib, $event.target.value)"
          >
            <option value="">(nothing)</option>
            <option v-for="f in pair.notetype.fields" :key="f" :value="f">{{ f }}</option>
          </select>
        </td>
        <td>
          <span class="lib-field">{{ lib }}</span>
          <span v-if="isNew(lib)" class="badge new-field">new field</span>
          <span v-else class="badge">{{ STATUS_TEXT[rowStatus(lib)] }}</span>
          <button
            v-if="isNew(lib)"
            class="link small forget"
            :title="`Don't add ${lib} to ${pair.modelName}`"
            @click="removeLibraryField(pair, lib)"
          >
            ×
          </button>
        </td>
        <td class="small">{{ example(lib) }}</td>
      </tr>
    </tbody>
  </table>
  <div class="row small map-foot">
    <span v-if="unmapped().length" class="warn-text">Not imported (no library field takes them):</span>
    <span v-for="f in unmapped()" :key="f" class="unmapped">
      {{ f }}
      <button v-if="canAdd(f)" class="link small" :title="`Add a ${f} field to ${pair.modelName}`" @click="addLibraryField(pair, f)">
        + add field
      </button>
    </span>
    <button class="link small reset" @click="resetFieldMap(pair)">Reset to matching names</button>
  </div>
  <p v-if="scheduled().length" class="muted small">
    New fields are added to <b>{{ pair.modelName }}</b> by Apply, after the backup, and only if a note fills them. Card
    templates won't show them until you edit the templates. Changing a note type's fields makes Anki's next AnkiWeb sync a
    one-way full sync.
  </p>
</template>
