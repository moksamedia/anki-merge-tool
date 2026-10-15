<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { mainFieldName } from '../lib/match.js'
import { needsFieldMap, pairKey, savedPairKey, unmappedFields } from '../lib/fieldMap.js'
import FieldMapTable from './FieldMapTable.vue'

// Shown after analysis. On top, the library type each package type maps to:
// its notes are matched only against that type, and its new notes are added to
// it (changing one re-analyzes). Below, the field map of each pair, then of any
// other type a possible duplicate was merged into by the user's choice.
const emit = defineEmits(['done'])
// focus: a pair key to open, scroll to and highlight (from Review's "check field mapping").
const props = defineProps({ focus: { type: String, default: null } })
const { state, settings, allFieldPairs, fieldMapOf, libFieldsOf, pkgSamples, setNoteTypeTarget, runAnalysis } =
  useMergeSession()

// Only note types that actually have notes in the package need a target.
const usedTypes = computed(() => {
  const counts = new Map()
  for (const n of state.pkg.notes) counts.set(n.notetypeId, (counts.get(n.notetypeId) ?? 0) + 1)
  return state.pkg.notetypes.filter((nt) => counts.has(nt.id)).map((nt) => ({ nt, notes: counts.get(nt.id) }))
})

/** Per package type: its target pair (null when a new type is created) and the other types it matched into. */
const groups = computed(() =>
  usedTypes.value.map(({ nt, notes }) => {
    const target = state.mapping[nt.id]
    const pairs = allFieldPairs.value.filter((p) => p.notetype.id === nt.id)
    let main = pairs.find((p) => p.configured) ?? null
    // A target no note goes through yet (every note matched elsewhere) still gets its map.
    if (!main && !target.create) {
      const libFields = libFieldsOf(target.modelName)
      main = {
        key: pairKey(nt.id, target.modelName),
        notetype: nt,
        modelName: target.modelName,
        libFields,
        configured: true,
        needsMap: needsFieldMap(nt, target.modelName, libFields),
        matched: 0,
        added: 0,
        samples: pkgSamples(nt.id),
      }
    }
    const matchOn = mainFieldName(target.create ? nt.fields : libFieldsOf(target.modelName), settings.mainField)
    const duplicates = state.entries.filter(
      (e) => e.notetype.id === nt.id && !state.merged[e.guid] && ((e.kind === 'new' && e.elsewhere?.length) || e.crossType),
    ).length
    return { nt, notes, target, main, others: pairs.filter((p) => !p.configured), matchOn, duplicates }
  }),
)

function targetValue(nt) {
  const m = state.mapping[nt.id]
  return m.create ? '__create__' : m.modelName
}

/** A free name for a new note type: the package name, suffixed if taken. */
function createName(nt) {
  let name = nt.name
  for (let i = 2; state.libModels.includes(name); i++) name = `${nt.name} (${i})`
  return name
}

/**
 * Change where a package type's new notes go, then re-analyze: the target also
 * steers matching (the preferred type among candidates, and the first-field
 * fallback), so a local re-classify wouldn't be exact. Decisions carry over
 * where the library note is unchanged.
 */
async function setTarget(nt, value) {
  await setNoteTypeTarget(
    nt,
    value === '__create__' ? { modelName: createName(nt), create: true } : { modelName: value, create: false },
  )
  await runAnalysis()
}

// Below the table: each target's field map, then the other types notes matched into.
const targetPairs = computed(() => groups.value.map((g) => g.main).filter(Boolean))
const otherPairs = computed(() => groups.value.flatMap((g) => g.others))
const createdTypes = computed(() => groups.value.filter((g) => g.target.create).map((g) => g.target.modelName))

const createNameTaken = (nt) => state.mapping[nt.id].create && state.libModels.includes(state.mapping[nt.id].modelName)
const blocked = computed(() => usedTypes.value.some(({ nt }) => createNameTaken(nt)))

// Each pair's table starts collapsed; which ones are open is remembered by
// note type names, so it carries over to later sessions and packages.
const nameKey = (pair) => savedPairKey(pair.notetype.name, pair.modelName)
const isOpen = (pair) => settings.openFieldPairs.includes(nameKey(pair))
function onToggle(pair, open) {
  if (open === isOpen(pair)) return
  const key = nameKey(pair)
  settings.openFieldPairs = open ? [...settings.openFieldPairs, key] : settings.openFieldPairs.filter((k) => k !== key)
}

const focused = ref(null)
onMounted(async () => {
  const pair = [...targetPairs.value, ...otherPairs.value].find((p) => p.key === props.focus)
  if (!pair) return
  onToggle(pair, true)
  focused.value = pair.key
  await nextTick()
  document.querySelector(`details.pair[data-key="${CSS.escape(pair.key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  setTimeout(() => (focused.value = null), 2500)
})

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
const unmappedOf = (pair) => unmappedFields(pair.notetype.fields, fieldMapOf(pair))
const pairCounts = (pair) =>
  [pair.matched && plural(pair.matched, 'matched note'), pair.added && plural(pair.added, 'new note')]
    .filter(Boolean)
    .join(' · ') || 'no notes yet'
</script>

<template>
  <section>
    <h2>Note types and fields</h2>

    <div class="card">
      <h3>Note types</h3>
      <p class="muted small">
        The library note type each package note type maps to: its notes are matched only against notes of that type, and
        its new notes are added to it. Changing one re-analyzes; choices are remembered for the next package with the same
        note types.
      </p>
      <table class="plain">
        <thead><tr><th>Package note type</th><th>Library note type</th><th>Notes</th></tr></thead>
        <tbody>
          <tr v-for="g in groups" :key="g.nt.id">
            <td>{{ g.nt.name }}</td>
            <td>
              <select :value="targetValue(g.nt)" :disabled="state.busy" @change="setTarget(g.nt, $event.target.value)">
                <option value="__create__">Create new note type</option>
                <option v-for="m in state.libModels" :key="m" :value="m">{{ m }}</option>
              </select>
              <input v-if="g.target.create" v-model.trim="state.mapping[g.nt.id].modelName" class="inline" spellcheck="false" />
              <span v-if="createNameTaken(g.nt)" class="warn-text small">name already exists</span>
            </td>
            <td class="small">
              {{ plural(g.notes, 'note') }} · matching on <b>{{ g.matchOn }}</b>
              <span v-if="g.duplicates" class="warn-text">
                · {{ plural(g.duplicates, 'possible duplicate') }} in other note types, decided in Review
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>Fields</h3>
      <p class="muted small">
        Which package field fills each library field. Same-named fields are paired automatically; choices are remembered,
        and Review updates as you change them. Click a pair to open it.
      </p>
      <details
        v-for="pair in targetPairs" :key="pair.key" class="pair"
        :class="{ focus: focused === pair.key }"
        :data-key="pair.key"
        :open="isOpen(pair)"
        @toggle="onToggle(pair, $event.target.open)"
      >
        <summary class="map-head">
          <h4>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h4>
          <span class="muted small">{{ pairCounts(pair) }}</span>
          <span v-if="unmappedOf(pair).length" class="warn-text small">not imported: {{ unmappedOf(pair).join(', ') }}</span>
          <span v-else-if="!pair.needsMap" class="ok-text small">fields line up by name</span>
        </summary>
        <FieldMapTable :pair="pair" />
      </details>
      <p v-if="createdTypes.length" class="muted small">
        {{ createdTypes.join(', ') }}: created as new note type{{ createdTypes.length === 1 ? '' : 's' }} with the
        package's fields, so there is nothing to map.
      </p>

      <template v-if="otherPairs.length">
        <h4 class="others">Merged into other note types</h4>
        <p class="muted small">
          Pairings created by merging possible duplicates, in Review, into existing notes of another type. Those notes stay
          in their type and are compared and filled through these maps. Fields pair by name until you change them, so check
          that each package field lands where it should.
        </p>
        <details
          v-for="pair in otherPairs" :key="pair.key" class="pair"
          :class="{ focus: focused === pair.key }"
          :data-key="pair.key"
          :open="isOpen(pair)"
          @toggle="onToggle(pair, $event.target.open)"
        >
          <summary class="map-head">
            <h4>{{ pair.notetype.name }} <span class="muted">→</span> {{ pair.modelName }}</h4>
            <span class="muted small">{{ pairCounts(pair) }}</span>
            <span v-if="unmappedOf(pair).length" class="warn-text small">not imported: {{ unmappedOf(pair).join(', ') }}</span>
            <span v-else-if="!pair.needsMap" class="ok-text small">fields line up by name</span>
          </summary>
          <FieldMapTable :pair="pair" />
        </details>
      </template>
    </div>

    <p v-if="blocked" class="warn-text small">A new note type's name is already taken; rename it to continue.</p>
    <button class="primary" :disabled="state.busy || blocked" @click="emit('done')">Continue to review →</button>
  </section>
</template>

<style scoped>
h4 { margin: 0; font-size: 1em; }
.others { margin: 18px 0 4px; }
summary.map-head { cursor: pointer; list-style: none; }
summary.map-head::-webkit-details-marker { display: none; }
summary.map-head h4::before { content: '▸'; display: inline-block; width: 1em; color: var(--muted); }
details[open] > summary.map-head h4::before { content: '▾'; }
details[open] > summary.map-head { margin-bottom: 8px; }
details.pair { margin-top: 8px; transition: box-shadow 0.4s, background 0.4s; border-radius: 6px; }
details.pair.focus { background: var(--fill-bg); box-shadow: 0 0 0 2px var(--accent); }
</style>
