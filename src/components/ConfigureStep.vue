<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { mainFieldName } from '../lib/match.js'

const emit = defineEmits(['done'])
const { settings, state, loadModelFields, runAnalysis } = useMergeSession()

// Only note types that actually have notes in the package need a target.
const usedTypes = computed(() => {
  const ids = new Set(state.pkg.notes.map((n) => n.notetypeId))
  return state.pkg.notetypes.filter((nt) => ids.has(nt.id))
})

const allFieldNames = computed(() => [...new Set(usedTypes.value.flatMap((nt) => nt.fields))])

function targetValue(nt) {
  const m = state.mapping[nt.id]
  return m.create ? '__create__' : m.modelName
}

async function setTarget(nt, value) {
  state.mapping[nt.id] =
    value === '__create__' ? { modelName: createName(nt), create: true } : { modelName: value, create: false }
  await loadModelFields()
}

/** A free name for a new note type: the package name, suffixed if taken. */
function createName(nt) {
  let name = nt.name
  for (let i = 2; state.libModels.includes(name); i++) name = `${nt.name} (${i})`
  return name
}

function fieldReport(nt) {
  const m = state.mapping[nt.id]
  if (m.create) return { missing: [], main: mainFieldName(nt.fields, settings.mainField) }
  const lib = state.libModelFields[m.modelName] ?? []
  return { missing: nt.fields.filter((f) => !lib.includes(f)), main: mainFieldName(lib, settings.mainField) }
}

const createNameTaken = (nt) => state.mapping[nt.id].create && state.libModels.includes(state.mapping[nt.id].modelName)

const canAnalyze = computed(() => state.targetDeck.trim() && !usedTypes.value.some(createNameTaken))

async function analyze() {
  await runAnalysis()
  if (state.entries.length && !state.error) emit('done')
}
</script>

<template>
  <section>
    <h2>Configure the merge</h2>

    <div class="grid2">
      <div class="card">
        <h3>Matching</h3>
        <label>
          Main field
          <input v-model.trim="settings.mainField" list="field-names" />
          <datalist id="field-names"><option v-for="f in allFieldNames" :key="f" :value="f" /></datalist>
        </label>
        <p class="muted small">
          Notes match by GUID first; otherwise by this field (ignoring case and formatting) within the target note type. Falls
          back to the first field when a note type lacks it.
        </p>
        <label class="toggle">
          <input v-model="settings.autoFillEmpty" type="checkbox" />
          Fill empty library fields automatically (no review needed)
        </label>
      </div>
      <div class="card">
        <h3>New notes</h3>
        <label>
          Target deck
          <input v-model.trim="state.targetDeck" list="deck-names" />
          <datalist id="deck-names"><option v-for="d in state.libDecks" :key="d" :value="d" /></datalist>
        </label>
        <p class="muted small">
          {{ state.libDecks.includes(state.targetDeck) ? 'Existing deck.' : 'Will be created.' }}
          Updated notes keep their current deck.
        </p>
      </div>
    </div>

    <div class="card">
      <h3>Note types</h3>
      <table class="plain">
        <thead><tr><th>Package note type</th><th>Library note type</th><th>Fields</th></tr></thead>
        <tbody>
          <tr v-for="nt in usedTypes" :key="nt.id">
            <td>{{ nt.name }}</td>
            <td>
              <select :value="targetValue(nt)" @change="setTarget(nt, $event.target.value)">
                <option value="__create__">Create new note type</option>
                <option v-for="m in state.libModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <input v-if="state.mapping[nt.id].create" v-model.trim="state.mapping[nt.id].modelName" class="inline" />
              <span v-if="createNameTaken(nt)" class="warn-text small">name already exists</span>
            </td>
            <td class="small">
              <span>matching on <b>{{ fieldReport(nt).main }}</b></span>
              <span v-if="fieldReport(nt).missing.length" class="warn-text">
                · not in library type (ignored): {{ fieldReport(nt).missing.join(', ') }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <button class="primary" :disabled="state.busy || !canAnalyze" @click="analyze">Analyze against library</button>
  </section>
</template>
