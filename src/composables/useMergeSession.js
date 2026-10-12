import { computed, reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { createAnkiClient, searchTerm } from '../lib/ankiClient.js'
import { analyze, initialResolution } from '../lib/match.js'
import { buildPlan, createReport, executePlan } from '../lib/applyMerge.js'

const DEFAULT_SETTINGS = {
  ankiConnectUrl: 'http://127.0.0.1:8765',
  bridgeUrl: 'http://127.0.0.1:8766',
  mainField: 'Tibetan',
  autoFillEmpty: true,
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback }
  } catch {
    return { ...fallback }
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage is a convenience only; the session works without it.
  }
}

const reviewKey = (path) => `review:${path}`

// Module-level singleton: every component shares one merge session.
const settings = reactive(load('settings', DEFAULT_SETTINGS))
watch(settings, () => save('settings', settings), { deep: true })

const client = createAnkiClient(settings)

const state = reactive({
  connection: { anki: null, bridge: null, checking: false },
  pkgPath: null,
  pkg: null,
  libModels: [],
  libDecks: [],
  libModelFields: {},
  mapping: {},
  targetDeck: '',
  busy: false,
  progress: '',
  error: null,
  entries: [],
  resolutions: {},
  excluded: new Set(),
  applyLog: [],
  report: null,
  applied: false,
})

watch(
  () => state.resolutions,
  (resolutions) => {
    if (state.pkgPath && state.entries.length) save(reviewKey(state.pkgPath), resolutions)
  },
  { deep: true },
)

async function run(task) {
  state.busy = true
  state.error = null
  try {
    return await task()
  } catch (e) {
    state.error = String(e?.message ?? e)
  } finally {
    state.busy = false
    state.progress = ''
  }
}

async function checkConnection() {
  state.connection.checking = true
  const [anki, bridge] = await Promise.allSettled([client.version(), client.bridgeHealth()])
  state.connection.anki =
    anki.status === 'fulfilled'
      ? { ok: true, detail: `AnkiConnect v${anki.value}` }
      : { ok: false, detail: String(anki.reason) }
  state.connection.bridge =
    bridge.status === 'fulfilled'
      ? bridge.value.collection_loaded
        ? { ok: true, detail: 'Collection loaded' }
        : { ok: false, detail: 'Bridge is running but no collection is loaded' }
      : { ok: false, detail: String(bridge.reason) }
  state.connection.checking = false
}

/** Most common deck among the package's notes — the natural default target. */
function dominantDeck(pkg) {
  const counts = new Map()
  for (const n of pkg.notes) counts.set(n.deckId, (counts.get(n.deckId) ?? 0) + 1)
  const [deckId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  return pkg.decks.find((d) => d.id === deckId)?.name ?? 'Default'
}

async function openPackage() {
  const path = await open({ multiple: false, filters: [{ name: 'Anki package', extensions: ['apkg'] }] })
  if (!path) return
  await run(async () => {
    state.progress = 'Reading package…'
    const pkg = await invoke('parse_apkg', { path })
    const [models, decks] = await Promise.all([client.modelNames(), client.deckNames()])

    state.pkgPath = path
    state.pkg = pkg
    state.libModels = models.sort()
    state.libDecks = decks.sort()
    state.targetDeck = dominantDeck(pkg)
    state.mapping = Object.fromEntries(
      pkg.notetypes.map((nt) => [nt.id, { modelName: nt.name, create: !models.includes(nt.name) }]),
    )
    state.entries = []
    state.resolutions = {}
    state.excluded = new Set()
    state.report = null
    state.applied = false
    await loadModelFields()
  })
}

async function loadModelFields() {
  const names = [...new Set(Object.values(state.mapping).filter((m) => !m.create).map((m) => m.modelName))]
  for (const name of names) {
    if (!state.libModelFields[name]) state.libModelFields[name] = await client.modelFieldNames(name)
  }
}

async function runAnalysis() {
  await run(async () => {
    const { pkg } = state
    await loadModelFields()

    state.progress = 'Looking up note GUIDs…'
    const guidMap = await client.notesByGuid(pkg.notes.map((n) => n.guid))

    const models = [...new Set(Object.values(state.mapping).filter((m) => !m.create).map((m) => m.modelName))]
    const ids = new Set(Object.values(guidMap))
    for (const model of models) {
      state.progress = `Finding library notes of type "${model}"…`
      for (const id of await client.findNotes(searchTerm('note', model))) ids.add(id)
    }

    state.progress = `Loading ${ids.size} library notes…`
    const libNotes = await client.notesInfo([...ids])

    const entries = analyze({ pkg, guidMap, libNotes, mapping: state.mapping, settings })
    const saved = load(reviewKey(state.pkgPath), {})
    state.resolutions = Object.fromEntries(
      entries.filter((e) => e.kind === 'conflict').map((e) => [e.guid, savedResolution(saved[e.guid], e)]),
    )
    state.entries = entries
    state.excluded = new Set()
  })
}

/** Reuse a saved decision only if it still covers exactly this entry's fields. */
function savedResolution(saved, entry) {
  const names = entry.fields.map((f) => f.name).sort().join('\u0000')
  if (saved?.values && Object.keys(saved.values).sort().join('\u0000') === names) return saved
  return initialResolution(entry)
}

const counts = computed(() => {
  const c = { new: 0, identical: 0, auto: 0, conflict: 0, ambiguous: 0 }
  for (const e of state.entries) {
    c[e.kind]++
    if (e.ambiguous) c.ambiguous++
  }
  return c
})

const plan = computed(() =>
  state.entries.length
    ? buildPlan({
        pkg: state.pkg,
        entries: state.entries,
        resolutions: state.resolutions,
        excluded: state.excluded,
        libModelFields: state.libModelFields,
        targetDeck: state.targetDeck,
      })
    : null,
)

async function applyMerge() {
  state.applyLog = []
  state.report = createReport()
  await run(async () => {
    await executePlan(client, plan.value, {
      report: state.report,
      readMedia: (names) => invoke('read_media', { path: state.pkgPath, names }),
      onProgress: (msg) => {
        state.progress = msg
        state.applyLog.push(msg)
      },
    })
    state.applied = true
    localStorage.removeItem(reviewKey(state.pkgPath))
  })
}

// Cached data: URLs for previews, keyed by source + filename.
const mediaCache = new Map()
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

function resolveMedia(name, source) {
  const key = `${source}\u0000${name}`
  if (!mediaCache.has(key)) {
    const mime = MIME[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream'
    const fetchPkg = () => invoke('read_media', { path: state.pkgPath, names: [name] }).then((m) => m[name])
    const fetchLib = () => client.retrieveMediaFile(name).then((b64) => b64 || undefined)
    const order = source === 'lib' ? [fetchLib, fetchPkg] : [fetchPkg, fetchLib]
    const promise = order[0]()
      .catch(() => undefined)
      .then((b64) => b64 ?? (source === 'result' ? order[1]().catch(() => undefined) : undefined))
      .then((b64) => (b64 ? `data:${mime};base64,${b64}` : null))
    mediaCache.set(key, promise)
  }
  return mediaCache.get(key)
}

export function useMergeSession() {
  return {
    settings,
    state,
    counts,
    plan,
    checkConnection,
    openPackage,
    loadModelFields,
    runAnalysis,
    applyMerge,
    resolveMedia,
  }
}
