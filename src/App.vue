<script setup>
import { computed, ref } from 'vue'
import { useMergeSession } from './composables/useMergeSession.js'
import ConnectStep from './components/ConnectStep.vue'
import PackageStep from './components/PackageStep.vue'
import ConfigureStep from './components/ConfigureStep.vue'
import ReviewStep from './components/ReviewStep.vue'
import ApplyStep from './components/ApplyStep.vue'

const { state } = useMergeSession()
const step = ref('connect')

const connected = computed(() => state.connection.anki?.ok && state.connection.bridge?.ok)
const steps = computed(() => [
  { id: 'connect', label: 'Connect', enabled: true },
  { id: 'package', label: 'Package', enabled: connected.value },
  { id: 'configure', label: 'Configure', enabled: connected.value && !!state.pkg },
  { id: 'review', label: 'Review', enabled: state.entries.length > 0 },
  { id: 'apply', label: 'Apply', enabled: state.entries.length > 0 },
])
</script>

<template>
  <nav class="steps">
    <button
      v-for="(s, i) in steps"
      :key="s.id"
      :class="{ on: step === s.id }"
      :disabled="!s.enabled"
      @click="step = s.id"
    >
      <span class="num">{{ i + 1 }}</span>{{ s.label }}
    </button>
    <span v-if="state.busy && state.progress" class="progress">{{ state.progress }}</span>
  </nav>

  <main>
    <div v-if="state.error" class="error" role="alert">
      {{ state.error }}
      <button class="link" @click="state.error = null">dismiss</button>
    </div>

    <ConnectStep v-if="step === 'connect'" />
    <button v-if="step === 'connect'" class="primary next" :disabled="!connected" @click="step = 'package'">
      Next →
    </button>
    <PackageStep v-else-if="step === 'package'" @done="step = 'configure'" />
    <ConfigureStep v-else-if="step === 'configure'" @done="step = 'review'" />
    <ReviewStep v-else-if="step === 'review'" @done="step = 'apply'" />
    <ApplyStep v-else-if="step === 'apply'" />
  </main>
</template>

<style>
:root {
  --bg: #f6f6f4;
  --panel: #ffffff;
  --text: #1e1f22;
  --muted: #6b6e76;
  --border: #dcdcd8;
  --accent: #2f6fdb;
  --accent-text: #ffffff;
  --ok: #1f8a4c;
  --warn: #b5560b;
  --danger: #c0352b;
  --ins-bg: #d5f5dd;
  --del-bg: #fbd9d6;
  --fill-bg: #eef6ff;
  --conflict-bg: #fff6ea;
  --manual-bg: #fdf3c4;
  --manual: #9a7b00;
  font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans Tibetan', sans-serif;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #18191c;
    --panel: #222328;
    --text: #e6e6e3;
    --muted: #9a9ca3;
    --border: #3a3b41;
    --accent: #5b8ff0;
    --ok: #4cc27f;
    --warn: #f0a050;
    --danger: #f06a5f;
    --ins-bg: #1f4a2c;
    --del-bg: #5a2420;
    --fill-bg: #1c2a3d;
    --conflict-bg: #3a2d1a;
    --manual-bg: #3a3415;
    --manual: #e3c450;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
main { padding: 16px 24px 48px; max-width: 1600px; margin: 0 auto; }
h2 { margin: 8px 0 12px; }
h3 { margin: 0 0 8px; font-size: 15px; }
code { font-size: 12px; background: var(--bg); padding: 1px 4px; border-radius: 4px; word-break: break-all; }

button {
  font: inherit; color: var(--text); background: var(--panel);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; cursor: pointer;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: 0.45; cursor: default; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); margin-top: 12px; }
button.link { border: none; background: none; color: var(--accent); padding: 4px 0; }
button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }

input, select, textarea {
  font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
}
label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
label.toggle { flex-direction: row; align-items: center; gap: 6px; }
input.inline { margin-left: 6px; width: 200px; }

.steps {
  position: sticky; top: 0; z-index: 2; display: flex; gap: 6px; align-items: center;
  padding: 10px 24px; background: var(--panel); border-bottom: 1px solid var(--border);
}
.steps .num {
  display: inline-grid; place-items: center; width: 18px; height: 18px; margin-right: 6px;
  border-radius: 50%; background: var(--border); font-size: 11px;
}
.steps .on .num { background: var(--accent); color: var(--accent-text); }
.progress { margin-left: auto; color: var(--muted); }
.next { display: block; }

.card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.ok-text { color: var(--ok); }
.warn-text { color: var(--warn); }
.error {
  background: var(--del-bg); color: var(--text); border: 1px solid var(--danger);
  border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; white-space: pre-wrap;
}
.badge {
  display: inline-block; font-size: 11px; padding: 1px 7px; margin: 0 4px;
  border: 1px solid var(--border); border-radius: 10px; color: var(--muted);
}
.badge.warn { color: var(--warn); border-color: var(--warn); }
.badge.accepted { color: var(--ok); border-color: var(--ok); }
.badge.skipped { color: var(--muted); }

table.plain { width: 100%; border-collapse: collapse; }
table.plain th, table.plain td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
tr.excluded { opacity: 0.45; }

.stats { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.stats > * { padding: 8px 14px; }
.stats small { color: var(--muted); margin-left: 4px; }

.split { display: grid; grid-template-columns: 240px 1fr; gap: 12px; align-items: start; }
.note-list {
  list-style: none; margin: 0; padding: 4px; max-height: 75vh; overflow: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
}
.note-list li { padding: 5px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note-list li.on { background: var(--fill-bg); }
.note-list .icon { display: inline-block; width: 16px; color: var(--muted); }
.note-list li.accepted .icon { color: var(--ok); }

.merge { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; min-width: 0; }
.merge-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.merge-head h3 { font-size: 20px; margin-bottom: 4px; }
table.fields { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.fields th, table.fields td { border: 1px solid var(--border); padding: 8px; vertical-align: top; text-align: left; }
table.fields thead th:first-child { width: 120px; }
table.fields tbody th small { display: block; font-weight: normal; color: var(--muted); }
table.fields tr.conflict th { background: var(--conflict-bg); }
table.fields tr.fill th { background: var(--fill-bg); }
.result textarea { width: 100%; font-family: ui-monospace, Menlo, monospace; font-size: 12px; resize: vertical; }
.pick { display: flex; gap: 4px; margin-bottom: 6px; }
.pick button { padding: 3px 8px; font-size: 12px; }

.raw { font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.raw .ins { background: var(--ins-bg); border-radius: 2px; }
.raw .del { background: var(--del-bg); border-radius: 2px; text-decoration: line-through; }
.empty, .missing { color: var(--muted); font-style: italic; }
.preview { word-break: break-word; font-size: 16px; }
.preview img { max-width: 100%; max-height: 220px; }
.preview .sound { font-size: 12px; color: var(--muted); }
.result .preview { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
footer.row { margin-top: 12px; }

.field-maps > summary { cursor: pointer; }
.field-maps[open] > summary { margin-bottom: 10px; }
.map-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.map-foot { margin-top: 6px; }
.map-foot button { margin-left: auto; }
button.fields-toggle { margin-top: 10px; }
.pair + .pair { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 14px; }
table.map td:first-child { width: 28%; font-weight: 600; }
table.map td:nth-child(2) { width: 36%; white-space: nowrap; }
table.map select { min-width: 160px; }
table.map tr td:first-child { border-left: 3px solid transparent; }
table.map tr.map-same td { background: var(--ins-bg); }
table.map tr.map-same td:first-child { border-left-color: var(--ok); }
table.map tr.map-same .badge { color: var(--ok); border-color: var(--ok); }
table.map tr.map-manual td { background: var(--manual-bg); }
table.map tr.map-manual td:first-child { border-left-color: var(--manual); }
table.map tr.map-manual .badge { color: var(--manual); border-color: var(--manual); }
table.map tr.map-none td { background: var(--del-bg); }
table.map tr.map-none td:first-child { border-left-color: var(--danger); }
table.map tr.map-none .badge { color: var(--danger); border-color: var(--danger); }
footer.row button.primary { margin-top: 0; }
</style>
