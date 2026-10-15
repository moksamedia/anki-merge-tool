<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMergeSession } from '../composables/useMergeSession.js'
import { allTags, emptyFilter, isFiltering, searchFields } from '../lib/reviewFilter.js'

// Filters every Review list: package note type, package tags (any of them,
// children included), and text in chosen fields of the package or library note.
const { state } = useMergeSession()
const filter = computed(() => state.reviewFilter)

const notetypes = computed(() => {
  const ids = new Set(state.entries.map((e) => String(e.notetype.id)))
  return state.pkg.notetypes.filter((nt) => ids.has(String(nt.id)))
})
const tags = computed(() => allTags(state.entries))
const fields = computed(() => searchFields(state.entries))

// Typing is debounced so a long list isn't re-filtered on every key.
const text = ref(filter.value.text)
let typing = null
watch(text, (value) => {
  clearTimeout(typing)
  typing = setTimeout(() => (state.reviewFilter.text = value), 200)
})
watch(
  () => filter.value.text,
  (value) => {
    if (value !== text.value) text.value = value
  },
)

const tagInput = ref('')
function addTag() {
  const tag = tagInput.value.trim()
  if (tag && !filter.value.tags.includes(tag)) state.reviewFilter.tags = [...filter.value.tags, tag]
  tagInput.value = ''
}
const removeTag = (tag) => (state.reviewFilter.tags = filter.value.tags.filter((t) => t !== tag))

// Fields popup: null in the filter means every field.
const showFields = ref(false)
const popup = ref(null)
const chosen = computed(() => new Set(filter.value.fields ?? fields.value.map((f) => f.name)))
function setField(name, on) {
  const next = new Set(chosen.value)
  if (on) next.add(name)
  else next.delete(name)
  state.reviewFilter.fields = next.size === fields.value.length ? null : [...next]
}
const setAllFields = (on) => (state.reviewFilter.fields = on ? null : [])
const fieldsLabel = computed(() =>
  filter.value.fields ? `${filter.value.fields.length} of ${fields.value.length} fields` : 'All fields',
)
const sideLabel = (f) => (f.pkg && f.lib ? 'both' : f.pkg ? 'package' : 'library')

function onOutside(e) {
  if (showFields.value && popup.value && !popup.value.contains(e.target)) showFields.value = false
}
onMounted(() => document.addEventListener('mousedown', onOutside))
onUnmounted(() => {
  document.removeEventListener('mousedown', onOutside)
  clearTimeout(typing)
})

function clear() {
  state.reviewFilter = emptyFilter()
  text.value = ''
  tagInput.value = ''
}
</script>

<template>
  <div class="review-filter row">
    <label class="small">
      Note type
      <select v-model="state.reviewFilter.notetype">
        <option value="">All</option>
        <option v-for="nt in notetypes" :key="nt.id" :value="String(nt.id)">{{ nt.name }}</option>
      </select>
    </label>

    <div class="tags small">
      <span>Tags</span>
      <span v-for="t in filter.tags" :key="t" class="chip">
        {{ t }}<button class="link" :aria-label="`Remove tag ${t}`" @click="removeTag(t)">×</button>
      </span>
      <input
        v-model="tagInput"
        list="review-tags"
        :placeholder="filter.tags.length ? 'or…' : 'any tag'"
        @change="addTag"
        @keydown.enter.prevent="addTag"
      />
      <datalist id="review-tags"><option v-for="t in tags" :key="t" :value="t" /></datalist>
    </div>

    <div ref="popup" class="search small">
      <input v-model="text" type="search" placeholder="Search text…" spellcheck="false" />
      <button :aria-expanded="showFields" title="Choose which fields the search looks in" @click="showFields = !showFields">
        {{ fieldsLabel }} ▾
      </button>
      <div v-if="showFields" class="fields-popup card" role="dialog" aria-label="Fields to search">
        <div class="row">
          <b>Search in</b>
          <button class="link" @click="setAllFields(true)">all</button>
          <button class="link" @click="setAllFields(false)">none</button>
        </div>
        <label v-for="f in fields" :key="f.name" class="toggle">
          <input type="checkbox" :checked="chosen.has(f.name)" @change="setField(f.name, $event.target.checked)" />
          {{ f.name }} <span class="muted">{{ sideLabel(f) }}</span>
        </label>
      </div>
    </div>

    <button v-if="isFiltering(filter)" class="link small" @click="clear">Clear filters</button>
  </div>
</template>

<style scoped>
.review-filter { gap: 16px; flex-wrap: wrap; align-items: center; margin: 8px 0 12px; }
.review-filter label { display: flex; align-items: center; gap: 6px; }
.tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tags input { width: 160px; }
.chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px 1px 8px; border: 1px solid var(--accent); border-radius: 10px; background: var(--fill-bg); }
.search { position: relative; display: flex; align-items: center; gap: 6px; }
.search input { width: 240px; }
.fields-popup {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; min-width: 260px; max-height: 360px;
  overflow-y: auto; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
}
.fields-popup .row { gap: 10px; margin-bottom: 4px; }
</style>
