import { computed, markRaw, reactive, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { createAnkiClient } from '../lib/ankiClient.js'
import { analyze, initialResolution, libraryFingerprint, rankCandidates, selectMatches } from '../lib/match.js'
import { buildPlan, createReport, defaultMergeTag, executePlan } from '../lib/applyMerge.js'
import { buildDryRun } from '../lib/dryRun.js'
import { defaultFieldMap, needsFieldMap, pairKey, reconcileFieldMap, savedPairKey, withNewFields } from '../lib/fieldMap.js'
import { buildSession, mergedFromRun, mergedMatches, parseSession, restoreSession, sessionPath, sessionSummary } from '../lib/session.js'

const DEFAULT_SETTINGS = {
  ankiConnectUrl: 'http://127.0.0.1:8765',
  bridgeUrl: 'http://127.0.0.1:8766',
  mainField: 'Tibetan',
  autoFillEmpty: true,
  ignoreGuid: false,
  // How Result cells are edited: 'code' (raw HTML) or 'editor' (like Anki's field editor).
  resultMode: 'code',
  // Whether field cells in the review show rendered HTML instead of the raw diff.
  rendered: false,
  // Field-map pairs left open on the Fields step, by note type names (savedPairKey).
  openFieldPairs: [],
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
  // {guid: libraryNoteId}: the user's choice where several library notes share a main field.
  picks: {},
  // New notes and auto-merges the user accepted. Merging is opt-in: nothing
  // outside this set (or, for conflicts, an accepted resolution) is written.
  accepted: new Set(),
  // When the entries were last analyzed, so merged notes know whether their
  // entry reflects the library after the merge.
  analyzedAt: null,
  // The ledger: {guid: {at, run, kind, libNoteId, fields, tags, ...}} for every
  // package note a run has written. Merged notes are read-only and never re-merged.
  merged: {},
  // One summary per Apply run, oldest first.
  runs: [],
  applyLog: [],
  report: null,
  // The session file next to the package: whether one was found, and when it was last written.
  session: { path: null, restored: false, savedAt: null },
  // Whether the Preview step has been shown since the last analysis.
  previewed: false,
})

// ---- session file -------------------------------------------------------
// Everything a review needs to be resumed is written next to the package as
// soon as analysis has run, then on every change (debounced).

let restoring = false
let saveTimer = null

function sessionSnapshot() {
  return JSON.stringify(buildSession({ state, settings }), null, 2)
}

async function saveSession() {
  if (!state.pkgPath || !state.entries.length) return
  const path = sessionPath(state.pkgPath)
  try {
    await invoke('write_text_file', { path, contents: sessionSnapshot() })
    state.session = { path, restored: true, savedAt: new Date().toISOString() }
  } catch (e) {
    state.error = `Could not save the merge session: ${e}`
  }
}

function scheduleSave() {
  if (restoring) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSession, 300)
}

watch(
  () => [
    state.resolutions,
    state.picks,
    state.accepted,
    state.merged,
    state.runs,
    state.mapping,
    state.fieldMaps,
    state.newFields,
    state.deckMode,
    state.targetDeck,
    state.mergeTag,
    settings.mainField,
    settings.ignoreGuid,
    settings.autoFillEmpty,
  ],
  scheduleSave,
  { deep: true },
)

/** Read a package's session file, or null if there is none (or it is unusable). */
async function readSession(pkgPath) {
  const text = await invoke('read_text_file', { path: sessionPath(pkgPath) })
  return parseSession(text)
}

/** Summaries of saved sessions for the Recent list: {path: summary}, only for packages that have one. */
async function peekSessions(paths) {
  const out = {}
  for (const path of paths) {
    try {
      const record = await readSession(path)
      if (record) out[path] = sessionSummary(record)
    } catch {
      // No summary for a file we can't read; the package itself may still open.
    }
  }
  return out
}

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
    // An unreadable session file shouldn't stop the package opening; say so and start fresh.
    const saved = await readSession(path).catch((e) => {
      state.error = `${e} — starting without the saved session.`
      return null
    })

    restoring = true
    try {
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
      state.picks = {}
      state.accepted = new Set()
      state.analyzedAt = null
      state.merged = {}
      state.runs = []
      state.report = null
      state.previewed = false
      state.session = { path: sessionPath(path), restored: false, savedAt: null }
      if (saved) restoreSaved(saved)
      await loadModelFields()
    } finally {
      restoring = false
    }
  })
}

/** Put a saved session's choices, decisions and ledger back into the state. */
function restoreSaved(record) {
  const r = restoreSession(record, { pkg: state.pkg, libModels: state.libModels })
  if (r.settings.mainField) settings.mainField = r.settings.mainField
  if (r.settings.ignoreGuid != null) settings.ignoreGuid = r.settings.ignoreGuid
  if (r.settings.autoFillEmpty != null) settings.autoFillEmpty = r.settings.autoFillEmpty
  if (r.deckMode) state.deckMode = r.deckMode
  if (r.targetDeck) state.targetDeck = r.targetDeck
  if (r.mergeTag != null) state.mergeTag = r.mergeTag
  Object.assign(state.mapping, r.mapping)
  state.fieldMaps = r.fieldMaps
  state.newFields = r.newFields
  // Decisions are raw until analysis checks them against the library (savedResolution).
  state.resolutions = r.resolutions
  // Applied by rankCandidates while the chosen note is still a candidate.
  state.picks = r.picks
  // Raw until analysis keeps only guids that are still new notes or auto-merges (classify).
  state.accepted = r.accepted
  state.merged = r.merged
  state.runs = r.runs
  state.session = { path: sessionPath(state.pkgPath), restored: true, savedAt: record.savedAt ?? null }
}

/** Open a package with a saved session and go straight to its review. True when analysis ran. */
async function resumeSession(path) {
  await openPackage(path)
  if (!state.pkg || state.error) return false
  await runAnalysis()
  return state.entries.length > 0 && !state.error
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
    // Notes an earlier run wrote are found through the ledger: an added note
    // has a fresh GUID in Anki, so neither GUID nor main field is reliable.
    const selected = selectMatches({ pkg, guidMap, records, mapping: state.mapping, settings })

    // Every candidate is loaded, not just the first, so ambiguous matches can be
    // ranked on content and switched in review without asking Anki again.
    const mergedIds = Object.values(state.merged).map((m) => m.libNoteId).filter((id) => id != null)
    const ids = [...new Set([...[...selected.values()].flatMap((m) => m.candidates), ...mergedIds])]
    state.progress = `Loading ${ids.length} matched library notes…`
    const libNotes = await client.notesInfo(ids)
    const ranked = rankCandidates({ pkg, matches: selected, libNotes, mapping: state.mapping, fieldMaps: state.fieldMaps, picks: state.picks })
    const matches = mergedMatches(ranked, state.merged)
    for (const n of libNotes) state.libModelFields[n.modelName] ??= n.fieldOrder
    await loadModelFonts([...new Set(libNotes.map((n) => n.modelName))])

    state.matches = markRaw(matches)
    state.libNotes = markRaw(libNotes)
    // Saved decisions (from the session file, or this session's) are kept where still valid.
    classify(state.resolutions)
    state.analyzedAt = new Date().toISOString()
    state.previewed = false
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
  // Merged notes are read-only: no resolution, whatever the re-analysis says about them.
  state.resolutions = Object.fromEntries(
    entries
      .filter((e) => e.kind === 'conflict' && !state.merged[e.guid])
      .map((e) => [e.guid, savedResolution(previous[e.guid], e)]),
  )
  state.entries = entries
  // An acceptance only holds while the note is still a new note or an
  // auto-merge: one that now matches, now conflicts or is merged drops out.
  const optIn = new Set(
    entries.filter((e) => (e.kind === 'new' || e.kind === 'auto') && !state.merged[e.guid]).map((e) => e.guid),
  )
  const kept = [...state.accepted].filter((guid) => optIn.has(guid))
  if (kept.length !== state.accepted.size) state.accepted = new Set(kept)
}

/**
 * Match a package note to another of its main-field candidates and
 * re-classify. The candidates are already loaded, so Anki isn't asked again.
 * The note's review decision resets (it was made against the other note).
 */
function pickCandidate(guid, libId) {
  const m = state.matches?.get(guid)
  if (!m?.candidates.includes(libId) || m.libId === libId) return
  state.picks = { ...state.picks, [guid]: libId }
  const matches = new Map(state.matches)
  matches.set(guid, { ...m, libId, picked: true })
  state.matches = markRaw(matches)
  classify(state.resolutions)
}

/** Show a library note in Anki's Browse window (close it again before applying). */
async function openInAnki(noteId) {
  try {
    await client.guiBrowse(`nid:${noteId}`)
  } catch (e) {
    state.error = `Could not open the note in Anki: ${e?.message ?? e}`
  }
}

/** Guids of open (not yet merged) entries of a kind that can be accepted in bulk. */
function openGuids(kinds) {
  return state.entries.filter((e) => kinds.includes(e.kind) && !state.merged[e.guid]).map((e) => e.guid)
}

/** Accept every open entry of `kind` ('new' | 'auto'). */
function acceptAll(kind) {
  state.accepted = new Set([...state.accepted, ...openGuids([kind])])
}

/** Withdraw acceptance from every entry of `kind`. */
function clearAll(kind) {
  const drop = new Set(openGuids([kind]))
  state.accepted = new Set([...state.accepted].filter((guid) => !drop.has(guid)))
}

/** Accept every new note and auto-merge: everything that has no conflict to decide. */
function acceptAllWithoutConflict() {
  state.accepted = new Set([...state.accepted, ...openGuids(['new', 'auto'])])
}

function setAccepted(guid, on) {
  if (on) state.accepted.add(guid)
  else state.accepted.delete(guid)
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
 * Pairs whose note types don't line up — the ones the Fields step lists. Exact,
 * because they come from the analysis: each package type's Configure target
 * (where its new notes go) and every library type its notes matched into.
 * Configure targets come first, in package order; then the rest, most matched first.
 */
const fieldPairs = computed(() => {
  const pairs = new Map()
  for (const e of state.entries) {
    // New notes follow the current Configure choice, even if it changed after analysis.
    const target = state.mapping[e.notetype.id] ?? e.target
    const modelName = e.libNote?.modelName ?? (e.fieldMap && !target.create ? target.modelName : null)
    if (!modelName) continue
    const key = pairKey(e.notetype.id, modelName)
    if (!pairs.has(key)) {
      const libFields = libFieldsOf(modelName)
      const configured = !target.create && target.modelName === modelName
      pairs.set(key, { key, notetype: e.notetype, modelName, libFields, configured, matched: 0, added: 0, samples: [] })
    }
    const pair = pairs.get(key)
    pair[e.libNote ? 'matched' : 'added']++
    if (pair.samples.length < 20) pair.samples.push(e.pkgFields)
  }
  const order = new Map((state.pkg?.notetypes ?? []).map((nt, i) => [nt.id, i]))
  return [...pairs.values()]
    .filter((p) => needsFieldMap(p.notetype, p.modelName, p.libFields))
    .sort(
      (a, b) =>
        b.configured - a.configured ||
        (a.configured ? order.get(a.notetype.id) - order.get(b.notetype.id) : b.matched - a.matched),
    )
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

/** Counts of what is still open; merged notes are counted once, under `merged`. */
const counts = computed(() => {
  const c = {
    new: 0, identical: 0, auto: 0, conflict: 0, merged: 0, ambiguous: 0, shared: 0, dropped: 0,
    // Accepted per kind: ticked new notes and auto-merges, accepted conflicts.
    accepted: { new: 0, auto: 0, conflict: 0 },
  }
  for (const e of state.entries) {
    if (state.merged[e.guid]) {
      c.merged++
      continue
    }
    c[e.kind]++
    if (e.kind === 'conflict' ? state.resolutions[e.guid]?.status === 'accepted' : state.accepted.has(e.guid)) {
      if (e.kind in c.accepted) c.accepted[e.kind]++
    }
    // Only matches that would write; an identical one leaves the library alone.
    if (e.ambiguous && e.kind !== 'identical') c.ambiguous++
    if (e.sharedWith?.length) c.shared++
    if (e.dropped?.length) c.dropped++
  }
  return c
})

/** Guids the plan must never write: already merged by an earlier run. */
const skipped = computed(() => new Set(Object.keys(state.merged)))

const plan = computed(() =>
  state.entries.length
    ? buildPlan({
        pkg: state.pkg,
        entries: state.entries,
        resolutions: state.resolutions,
        excluded: skipped.value,
        accepted: state.accepted,
        deckMode: state.deckMode,
        targetDeck: state.targetDeck,
        mergeTag: state.mergeTag,
        newFields: state.newFields,
      })
    : null,
)

/** The dry-run report for the current plan; recomputed live as review decisions change. */
const dryRun = computed(() =>
  plan.value
    ? buildDryRun({
        pkg: state.pkg,
        pkgPath: state.pkgPath,
        settings,
        entries: state.entries,
        plan: plan.value,
        resolutions: state.resolutions,
        excluded: skipped.value,
        accepted: state.accepted,
        merged: state.merged,
        libDecks: state.libDecks,
        mapping: state.mapping,
        fieldMaps: fieldPairs.value.map((p) => ({
          package: p.notetype.name,
          library: p.modelName,
          packageFields: p.notetype.fields,
          fieldMap: fieldMapOf(p),
        })),
      })
    : null,
)

const dryRunJson = () => JSON.stringify(dryRun.value, null, 2)

async function copyDryRun() {
  await navigator.clipboard.writeText(dryRunJson())
}

/** Save the report via a save dialog. Returns the chosen path, or null if cancelled. */
async function saveDryRun() {
  const base = (state.pkgPath?.split(/[\\/]/).pop() ?? 'package').replace(/\.apkg$/i, '')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  const path = await saveDialog({
    defaultPath: `${base}-dry-run-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (!path) return null
  await invoke('write_text_file', { path, contents: dryRunJson() })
  return path
}

/**
 * Write the current plan: every approved note not yet merged. Can be run
 * again as more notes are approved; whatever landed goes into the ledger (even
 * if a later step failed), so the next run only writes the rest.
 */
async function applyMerge() {
  state.applyLog = []
  state.report = createReport()
  const current = plan.value
  await run(async () => {
    await executePlan(client, current, {
      report: state.report,
      readMedia: (names) => invoke('read_media', { path: state.pkgPath, names }),
      onProgress: (msg) => {
        state.progress = msg
        state.applyLog.push(msg)
      },
    })
  })
  // The report is filled in place, so partial results are recorded even after a throw.
  const { merged, run: summary } = mergedFromRun({
    plan: current,
    report: state.report,
    entries: state.entries,
    run: state.runs.length + 1,
  })
  summary.error = state.error
  state.merged = { ...state.merged, ...merged }
  state.runs = [...state.runs, summary]
  for (const guid of Object.keys(merged)) delete state.resolutions[guid]
  // A created note type now exists: later runs (and packages) map onto it instead of creating it again.
  for (const modelName of state.report.modelsCreated) {
    if (!state.libModels.includes(modelName)) state.libModels = [...state.libModels, modelName].sort()
    for (const nt of state.pkg.notetypes) {
      const m = state.mapping[nt.id]
      if (m?.create && m.modelName === modelName) {
        state.mapping[nt.id] = { modelName, create: false }
        savedTargets[nt.name] = { modelName, create: false }
      }
    }
  }
  if (state.report.modelsCreated.length) save('noteTypeTargets', savedTargets)
  // Fields that now exist in Anki stop being "scheduled", even if a later step failed.
  for (const { modelName, fieldName } of state.report.fieldsCreated) {
    state.libModelFields[modelName] = [...(state.libModelFields[modelName] ?? []), fieldName]
    state.newFields[modelName] = (state.newFields[modelName] ?? []).filter((f) => f !== fieldName)
  }
  await saveSession()
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
    dryRun,
    copyDryRun,
    saveDryRun,
    fieldPairs,
    fieldMapOf,
    libFieldsOf,
    setFieldMap,
    addLibraryField,
    removeLibraryField,
    resetFieldMap,
    checkConnection,
    openPackage,
    resumeSession,
    peekSessions,
    forgetRecent,
    setNoteTypeTarget,
    loadModelFields,
    runAnalysis,
    acceptAll,
    clearAll,
    acceptAllWithoutConflict,
    setAccepted,
    pickCandidate,
    openInAnki,
    applyMerge,
    resolveMedia,
    fieldFont,
    pkgDeckName,
  }
}
