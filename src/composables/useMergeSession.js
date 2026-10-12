import { computed, markRaw, reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { createAnkiClient } from '../lib/ankiClient.js'
import { analyze, initialResolution, libraryFingerprint, selectMatches } from '../lib/match.js'
import { buildPlan, createReport, defaultMergeTag, executePlan } from '../lib/applyMerge.js'
import { defaultFieldMap, needsFieldMap, pairKey, reconcileFieldMap, savedPairKey, withNewFields } from '../lib/fieldMap.js'

const DEFAULT_SETTINGS = {
  ankiConnectUrl: 'http://127.0.0.1:8765',
  bridgeUrl: 'http://127.0.0.1:8766',
  mainField: 'Tibetan',
  autoFillEmpty: true,
  ignoreGuid: false,
  // How Result cells are edited: 'code' (raw HTML) or 'editor' (like Anki's field editor).
  resultMode: 'code',
}

function load(key, fallback) {
  const copy = (v) => (Array.isArray(fallback) ? [...v] : { ...fallback, ...v })
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : fallback
    return Array.isArray(fallback) === Array.isArray(parsed) ? copy(parsed) : copy(fallback)
  } catch {
    return copy(fallback)
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

// Choices remembered app-wide, across packages and sessions, by note type names:
// field maps per (package type, library type), and each package type's target.
const savedFieldMaps = load('fieldMaps', {})
const savedTargets = load('noteTypeTargets', {})

const RECENT_LIMIT = 5

const state = reactive({
  connection: { anki: null, bridge: null, checking: false },
  // Most recently opened package paths, newest first.
  recentPackages: load('recentPackages', []),
  pkgPath: null,
  pkg: null,
  libModels: [],
  libDecks: [],
  libModelFields: {},
  // {modelName: {field: {font, size}}}, the editor fonts Anki uses per field.
  libModelFonts: {},
  mapping: {},
  // {pairKey: {libraryField: packageField | ''}} per (package type, library type) pair.
  fieldMaps: {},
  // {modelName: [fieldName]}: library fields to add, created by Apply after the backup.
  newFields: {},
  // 'package' keeps each new note in its package deck; 'single' sends all to targetDeck.
  deckMode: 'single',
  targetDeck: '',
  // Added to every note the merge writes; blank disables it.
  mergeTag: '',
  busy: false,
  progress: '',
  error: null,
  // Phase 1 results, kept so remapping fields re-classifies without asking Anki again.
  matches: null,
  libNotes: [],
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

/** Name of a package deck by id, if the package lists it. */
const pkgDeckName = (id) => state.pkg?.decks.find((d) => d.id === id)?.name

/** Number of distinct decks the package's notes live in. */
function noteDeckCount(pkg) {
  return new Set(pkg.notes.map((n) => n.deckId)).size
}

/** Most common deck among the package's notes — the natural single-deck target. */
function dominantDeck(pkg) {
  const counts = new Map()
  for (const n of pkg.notes) counts.set(n.deckId, (counts.get(n.deckId) ?? 0) + 1)
  const [deckId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  return pkg.decks.find((d) => d.id === deckId)?.name ?? 'Default'
}

/** Open a package: `path` reopens a known file, otherwise a file dialog asks for one. */
async function openPackage(path = null) {
  path ??= await open({ multiple: false, filters: [{ name: 'Anki package', extensions: ['apkg'] }] })
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
    state.deckMode = noteDeckCount(pkg) > 1 ? 'package' : 'single'
    state.mergeTag = defaultMergeTag()
    state.mapping = Object.fromEntries(pkg.notetypes.map((nt) => [nt.id, initialTarget(nt, models)]))
    rememberRecent(path)
    state.fieldMaps = {}
    state.newFields = {}
    state.matches = null
    state.libNotes = []
    state.entries = []
    state.resolutions = {}
    state.excluded = new Set()
    state.report = null
    state.applied = false
    state.attempted = false
    await loadModelFields()
  })
}

/**
 * The library note type a package type goes to: the remembered choice while
 * that type still exists, else the same-named type, else a new one. A
 * remembered "create" falls back to the default, so once a merge has created
 * the type, later packages map onto it instead of creating another.
 */
function initialTarget(nt, models) {
  const saved = savedTargets[nt.name]
  if (saved && !saved.create && models.includes(saved.modelName)) return { modelName: saved.modelName, create: false }
  return { modelName: nt.name, create: !models.includes(nt.name) }
}

/** Set a package type's target library note type, and remember it by name. */
async function setNoteTypeTarget(nt, target) {
  state.mapping[nt.id] = target
  savedTargets[nt.name] = { modelName: target.modelName, create: target.create }
  save('noteTypeTargets', savedTargets)
  await loadModelFields()
}

function rememberRecent(path) {
  state.recentPackages = [path, ...state.recentPackages.filter((p) => p !== path)].slice(0, RECENT_LIMIT)
  save('recentPackages', state.recentPackages)
}

function forgetRecent(path) {
  state.recentPackages = state.recentPackages.filter((p) => p !== path)
  save('recentPackages', state.recentPackages)
}

async function loadModelFields() {
  const names = [...new Set(Object.values(state.mapping).filter((m) => !m.create).map((m) => m.modelName))]
  for (const name of names) {
    if (!state.libModelFields[name]) state.libModelFields[name] = await client.modelFieldNames(name)
  }
  await loadModelFonts(names)
}

/** Best effort: an AnkiConnect without modelFieldFonts just leaves the default font. */
async function loadModelFonts(names) {
  for (const name of names) {
    if (state.libModelFonts[name]) continue
    try {
      state.libModelFonts[name] = await client.modelFieldFonts(name)
    } catch {
      state.libModelFonts[name] = {}
    }
  }
}

const DEFAULT_FIELD_FONT = { font: 'Arial', size: 20 }

/** The font Anki's editor would use for a library field. */
function fieldFont(modelName, field) {
  const f = state.libModelFonts[modelName]?.[field]
  return f?.font ? { font: f.font, size: f.size || DEFAULT_FIELD_FONT.size } : DEFAULT_FIELD_FONT
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
    for (const n of libNotes) state.libModelFields[n.modelName] ??= n.fieldOrder
    await loadModelFonts([...new Set(libNotes.map((n) => n.modelName))])

    state.matches = markRaw(matches)
    state.libNotes = markRaw(libNotes)
    classify(load(reviewKey(state.pkgPath), {}))
    state.excluded = new Set()
    state.applied = false
    state.attempted = false
  })
}

/**
 * A field map for every (package type, existing library type) pair the analysis
 * writes through: matched notes' library types, and the Configure target for
 * new notes. Starts from the remembered map for those names, else by name.
 */
function initialFieldMaps() {
  const notetypes = new Map(state.pkg.notetypes.map((nt) => [nt.id, nt]))
  const libById = new Map(state.libNotes.map((n) => [n.id, n]))
  const maps = {}
  for (const note of state.pkg.notes) {
    const nt = notetypes.get(note.notetypeId)
    const target = state.mapping[nt.id]
    const libNote = libById.get(state.matches.get(note.guid)?.libId)
    const modelName = libNote?.modelName ?? (target.create ? null : target.modelName)
    const key = modelName && pairKey(nt.id, modelName)
    if (!key || maps[key]) continue
    maps[key] = fieldMapOf({ key, notetype: nt, modelName, libFields: libFieldsOf(modelName) })
  }
  return maps
}

/** A library note type's fields, including ones scheduled to be added. */
function libFieldsOf(modelName) {
  const existing = state.libModelFields[modelName] ?? []
  return [...existing, ...(state.newFields[modelName] ?? []).filter((f) => !existing.includes(f))]
}

/** Phase 2: classify against the kept matches, reusing still-valid decisions from `previous`. */
function classify(previous) {
  // Re-derive maps so every pair covers scheduled new fields too.
  state.fieldMaps = initialFieldMaps()
  const entries = analyze({
    pkg: state.pkg,
    matches: state.matches,
    libNotes: withNewFields(state.libNotes, state.newFields),
    mapping: state.mapping,
    settings,
    fieldMaps: state.fieldMaps,
    libModelFields: Object.fromEntries(Object.keys(state.libModelFields).map((m) => [m, libFieldsOf(m)])),
  })
  state.resolutions = Object.fromEntries(
    entries.filter((e) => e.kind === 'conflict').map((e) => [e.guid, savedResolution(previous[e.guid], e)]),
  )
  state.entries = entries
}

/**
 * The map in effect for a pair: the session's, else the remembered one, else by
 * name, made to cover the pair's current library fields. Doesn't write state,
 * so templates can call it before analysis (Configure).
 */
function fieldMapOf(pair) {
  const chosen = state.fieldMaps[pair.key] ?? savedFieldMaps[savedPairKey(pair.notetype.name, pair.modelName)]
  return reconcileFieldMap(chosen, pair.notetype.fields, pair.libFields)
}

/** Point a library field at a package field ('' for none), remember it, and re-classify. */
function setFieldMap(pair, libField, pkgField) {
  state.fieldMaps[pair.key] = { ...fieldMapOf(pair), [libField]: pkgField }
  rememberFieldMap(pair)
}

/**
 * Schedule a library field named after a package field and map that package
 * field into it. Nothing is written to Anki until Apply, after the backup.
 */
function addLibraryField(pair, pkgField) {
  const scheduled = state.newFields[pair.modelName] ?? []
  if (!scheduled.includes(pkgField)) state.newFields[pair.modelName] = [...scheduled, pkgField]
  setFieldMap(pair, pkgField, pkgField)
}

/** Unschedule a field added with addLibraryField. */
function removeLibraryField(pair, field) {
  state.newFields[pair.modelName] = (state.newFields[pair.modelName] ?? []).filter((f) => f !== field)
  const map = { ...fieldMapOf(pair) }
  delete map[field]
  state.fieldMaps[pair.key] = map
  rememberFieldMap(pair)
}

function resetFieldMap(pair) {
  state.fieldMaps[pair.key] = defaultFieldMap(pair.notetype.fields, pair.libFields)
  rememberFieldMap(pair)
}

function rememberFieldMap(pair) {
  savedFieldMaps[savedPairKey(pair.notetype.name, pair.modelName)] = { ...state.fieldMaps[pair.key] }
  save('fieldMaps', savedFieldMaps)
  // Before analysis (mapping from Configure) there is nothing to re-classify.
  // Decisions whose package side changed are reset by the fingerprint check.
  if (state.matches) classify(state.resolutions)
}

/**
 * Pairs whose note types don't line up (different names, or fields the
 * same-name default leaves unpaired) — the ones Review's Field mapping panel lists.
 */
const fieldPairs = computed(() => {
  const pairs = new Map()
  for (const e of state.entries) {
    const modelName = e.libNote?.modelName ?? (e.fieldMap ? e.target.modelName : null)
    if (!modelName) continue
    const key = pairKey(e.notetype.id, modelName)
    if (!pairs.has(key)) {
      const libFields = libFieldsOf(modelName)
      pairs.set(key, { key, notetype: e.notetype, modelName, libFields, matched: 0, added: 0, samples: [] })
    }
    const pair = pairs.get(key)
    pair[e.libNote ? 'matched' : 'added']++
    if (pair.samples.length < 20) pair.samples.push(e.pkgFields)
  }
  return [...pairs.values()].filter((p) => needsFieldMap(p.notetype, p.modelName, p.libFields))
})

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
        deckMode: state.deckMode,
        targetDeck: state.targetDeck,
        mergeTag: state.mergeTag,
        newFields: state.newFields,
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
  // Fields that now exist in Anki stop being "scheduled", even if a later step failed.
  for (const { modelName, fieldName } of state.report.fieldsCreated) {
    state.libModelFields[modelName] = [...(state.libModelFields[modelName] ?? []), fieldName]
    state.newFields[modelName] = (state.newFields[modelName] ?? []).filter((f) => f !== fieldName)
  }
}

// Cached data: URLs for previews, keyed by source + filename.
const mediaCache = new Map()
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', spx: 'audio/ogg', webm: 'audio/webm', mp4: 'audio/mp4', '3gp': 'audio/3gpp',
}

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
    fieldPairs,
    fieldMapOf,
    libFieldsOf,
    setFieldMap,
    addLibraryField,
    removeLibraryField,
    resetFieldMap,
    checkConnection,
    openPackage,
    forgetRecent,
    setNoteTypeTarget,
    loadModelFields,
    runAnalysis,
    applyMerge,
    resolveMedia,
    fieldFont,
    pkgDeckName,
  }
}
