import { computed, reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { createAnkiClient } from '../lib/ankiClient.js'
import { analyze, initialResolution, libraryFingerprint, selectMatches } from '../lib/match.js'
import { buildPlan, createReport, executePlan } from '../lib/applyMerge.js'

const DEFAULT_SETTINGS = {
  ankiConnectUrl: 'http://127.0.0.1:8765',
  bridgeUrl: 'http://127.0.0.1:8766',
  mainField: 'Tibetan',
  autoFillEmpty: true,
  ignoreGuid: false,
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
  // Set on any apply attempt. A failed attempt may have written some notes, so
  // re-applying the same plan would duplicate them; analysis must be re-run.
  attempted: false,
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
  // An older bridge answers /health but lacks the routes this app needs.
  if (state.connection.bridge.ok) {
    try {
      await client.notesByGuid([])
      await client.fieldValues('')
    } catch {
      state.connection.bridge = {
        ok: false,
        detail: 'Bridge is outdated — update anki-ai-bridge and restart Anki (needs /backup, /notes/by-guid, /notes/field-values)',
      }
    }
  }
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
    state.attempted = false
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

    let guidMap = {}
    if (!settings.ignoreGuid) {
      state.progress = 'Looking up note GUIDs…'
      guidMap = await client.notesByGuid(pkg.notes.map((n) => n.guid))
    }

    // Library-wide main-field values in one bridge call. AnkiConnect findNotes
    // is avoided: on large libraries it exhausts its search-cursor cache.
    state.progress = 'Reading library field values…'
    const records = await client.fieldValues(settings.mainField || '')
    const matches = selectMatches({ pkg, guidMap, records, mapping: state.mapping, settings })

    const ids = [...new Set([...matches.values()].map((m) => m.libId))]
    state.progress = `Loading ${ids.length} matched library notes…`
    const libNotes = await client.notesInfo(ids)

    const entries = analyze({ pkg, matches, libNotes, mapping: state.mapping, settings })
    const saved = load(reviewKey(state.pkgPath), {})
    state.resolutions = Object.fromEntries(
      entries.filter((e) => e.kind === 'conflict').map((e) => [e.guid, savedResolution(saved[e.guid], e)]),
    )
    state.entries = entries
    state.excluded = new Set()
    state.applied = false
    state.attempted = false
  })
}

/** Reuse a saved decision only if the library note it was made against is unchanged. */
function savedResolution(saved, entry) {
  const names = entry.fields.map((f) => f.name).sort().join('\u0000')
  if (
    saved?.values &&
    saved.lib === libraryFingerprint(entry) &&
    Object.keys(saved.values).sort().join('\u0000') === names
  ) {
    return saved
  }
  return initialResolution(entry)
}

const counts = computed(() => {
  const c = { new: 0, identical: 0, auto: 0, conflict: 0, ambiguous: 0, shared: 0, dropped: 0 }
  for (const e of state.entries) {
    c[e.kind]++
    if (e.ambiguous) c.ambiguous++
    if (e.sharedWith?.length) c.shared++
    if (e.dropped?.length) c.dropped++
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
  state.attempted = true
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
