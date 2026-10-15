<script setup>
import { computed } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { mainFieldName } from '../lib/match.js'
import { pairKey, savedPairKey, unmappedFields } from '../lib/fieldMap.js'
import FieldMapTable from './FieldMapTable.vue'

// Shown after analysis, when it's known which library note types the package
// notes go through. One section per package note type: the library type its
// new notes go to (changeable here, which re-analyzes), then any other types
// its notes matched into. Fields pair by name unless changed here.
const emit = defineEmits(['done'])
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
        matched: 0,
        added: 0,
        samples: pkgSamples(nt.id),
      }
    }
    const matchOn = mainFieldName(target.create ? nt.fields : libFieldsOf(target.modelName), settings.mainField)
    return { nt, notes, target, main, others: pairs.filter((p) => !p.configured), matchOn }
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
    <p class="muted small">
      For each package note type, choose the library note type its new notes go to, and which package field fills each
      library field. Same-named fields are paired automatically. Choices are remembered for the next package with the
      same note types, and Review updates as you change them.
    </p>

    <div v-for="g in groups" :key="g.nt.id" class="card">
      <div class="map-head">
        <h3>{{ g.nt.name }}</h3>
        <span class="muted small">{{ plural(g.notes, 'note') }} in the package · matching on <b>{{ g.matchOn }}</b></span>
      </div>
      <label class="target">
        New notes go to
        <select :value="targetValue(g.nt)" :disabled="state.busy" @change="setTarget(g.nt, $event.target.value)">
          <option value="__create__">Create new note type</option>
          <option v-for="m in state.libModels" :key="m" :value="m">{{ m }}</option>
        </select>
        <input v-if="g.target.create" v-model.trim="state.mapping[g.nt.id].modelName" class="inline" spellcheck="false" />
        <span v-if="createNameTaken(g.nt)" class="warn-text small">name already exists</span>
      </label>
      <p v-if="g.target.create" class="muted small">A new note type is created with the package's fields and templates.</p>

      <details v-if="g.main" class="pair" :open="isOpen(g.main)" @toggle="onToggle(g.main, $event.target.open)">
        <summary class="map-head">
          <h4>→ {{ g.main.modelName }}</h4>
          <span class="muted small">{{ pairCounts(g.main) }}</span>
          <span v-if="unmappedOf(g.main).length" class="warn-text small">not imported: {{ unmappedOf(g.main).join(', ') }}</span>
          <span v-else-if="!g.main.needsMap" class="ok-text small">fields line up by name</span>
        </summary>
        <FieldMapTable :pair="g.main" />
      </details>

      <template v-if="g.others.length">
        <p class="muted small others">
          Also matched into existing notes of other types. These notes stay in their type; they're compared and filled
          through these maps, and new notes never go here.
        </p>
        <details v-for="pair in g.others" :key="pair.key" class="pair" :open="isOpen(pair)" @toggle="onToggle(pair, $event.target.open)">
          <summary class="map-head">
            <h4>→ {{ pair.modelName }}</h4>
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
.target { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0 8px; }
h4 { margin: 0; font-size: 1em; }
.others { margin: 12px 0 0; }
summary.map-head { cursor: pointer; list-style: none; }
summary.map-head::-webkit-details-marker { display: none; }
summary.map-head h4::before { content: '▸'; display: inline-block; width: 1em; color: var(--muted); }
details[open] > summary.map-head h4::before { content: '▾'; }
details[open] > summary.map-head { margin-bottom: 8px; }
details.pair { margin-top: 8px; }
</style>
