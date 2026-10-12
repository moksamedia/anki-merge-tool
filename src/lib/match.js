// Matching package notes to library notes and classifying the differences.
// Pure functions — no Anki or Tauri access — so they are unit-tested directly.

import { defaultFieldMap, pairKey } from './fieldMap.js'

/**
 * Normalise a field for equality checks: whitespace, &nbsp; and Unicode
 * composition differences don't count. NFD makes a precomposed Tibetan stack
 * (e.g. U+0F43 གྷ) equal to its two-codepoint spelling (U+0F42 U+0FB7).
 */
export function normalizeValue(value) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/\s+/g, ' ')
    .trim()
}

// Trailing Tibetan punctuation that doesn't change which word a field names:
// tsheg U+0F0B, shads U+0F0D–U+0F12, gter tsheg U+0F14 (plus whitespace between).
const TRAILING_TIBETAN_PUNCT = /[\u0F0B\u0F0D-\u0F12\u0F14\s]+$/

/**
 * Key used to match notes by main field. Beyond normalizeValue it ignores
 * markup, case, non-breaking vs normal tsheg, and trailing tsheg/shad, so
 * བཀྲ་ཤིས་, བཀྲ་ཤིས and བཀྲ་ཤིས། all match. Used only for matching; stored text is untouched.
 */
export function matchKey(value) {
  return normalizeValue((value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\u0F0C/g, '\u0F0B')
    .replace(TRAILING_TIBETAN_PUNCT, '')
    .toLowerCase()
}

const isEmpty = (value) => matchKey(value) === '' && !/<img|\[sound:/i.test(value ?? '')

/** Package note fields as {name: value} using its notetype's field order. */
export function namedFields(note, notetype) {
  return Object.fromEntries(notetype.fields.map((name, i) => [name, note.fields[i] ?? '']))
}

/** The configured main field as spelled in this field list (case-insensitive), or undefined. */
export function findMainField(fieldNames, preferred) {
  const lower = preferred?.trim().toLowerCase()
  return fieldNames.find((f) => f.toLowerCase() === lower)
}

/** The field used for matching: the configured main field, else the notetype's first field. */
export function mainFieldName(fieldNames, preferred) {
  return findMainField(fieldNames, preferred) ?? fieldNames[0]
}

function push(map, key, record) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(record)
}

/**
 * Lightweight library record used for matching: {id, modelName, main, first}.
 * `main` is null when the note's type lacks the main field. The bridge's
 * /notes/field-values returns these for the whole library; this builds the same
 * shape from full notes (used by tests).
 */
export function toRecord(note, preferredMainField) {
  const main = findMainField(note.fieldOrder, preferredMainField)
  return {
    id: note.id,
    modelName: note.modelName,
    main: main ? note.fields[main] : null,
    first: note.fields[note.fieldOrder[0]],
  }
}

/**
 * Index library records for main-field matching. Several notes can share a
 * key; all are kept so ambiguity can be reported.
 *
 * - `byMainField`: key -> records, across every note type and deck that has the
 *   main field. This is the library-wide index.
 * - `byFirstField`: (model, first-field key) -> records, used when the package
 *   note type has no main field. A first field means different things in
 *   different note types, so this fallback stays within the mapped note type.
 */
export function indexLibrary(records) {
  const byMainField = new Map()
  const byFirstField = new Map()
  for (const r of records) {
    const mainKey = r.main == null ? '' : matchKey(r.main)
    if (mainKey) push(byMainField, mainKey, r)
    const firstKey = matchKey(r.first)
    if (firstKey) push(byFirstField, `${r.modelName}\u0000${firstKey}`, r)
  }
  return { byMainField, byFirstField }
}

/** Main-field candidates for a package note, preferring the mapped note type. */
function fieldCandidates(index, notetype, fields, target, preferredMainField) {
  const main = findMainField(notetype.fields, preferredMainField)
  if (!main) {
    const key = matchKey(fields[notetype.fields[0]])
    return key ? index.byFirstField.get(`${target.modelName}\u0000${key}`) ?? [] : []
  }
  const key = matchKey(fields[main])
  const hits = key ? index.byMainField.get(key) ?? [] : []
  return [...hits].sort((a, b) => (b.modelName === target.modelName) - (a.modelName === target.modelName))
}

/**
 * Phase 1: pick a library note id for each package note, from GUIDs and the
 * lightweight library records — before any full note is loaded.
 *
 * @param guidMap  {guid: libraryNoteId} from the bridge ({} when GUIDs are ignored)
 * @param records  library records, see toRecord()
 * @returns Map guid -> {libId, matchedBy: 'guid'|'field', candidates}; unmatched notes are absent
 */
export function selectMatches({ pkg, guidMap, records, mapping, settings }) {
  const notetypes = new Map(pkg.notetypes.map((nt) => [nt.id, nt]))
  const index = indexLibrary(records)
  const matches = new Map()
  for (const note of pkg.notes) {
    const guidHit = settings.ignoreGuid ? undefined : guidMap[note.guid]
    if (guidHit !== undefined) {
      matches.set(note.guid, { libId: guidHit, matchedBy: 'guid', candidates: 1 })
      continue
    }
    const notetype = notetypes.get(note.notetypeId)
    const hits = fieldCandidates(index, notetype, namedFields(note, notetype), mapping[note.notetypeId], settings.mainField)
    if (hits.length) matches.set(note.guid, { libId: hits[0].id, matchedBy: 'field', candidates: hits.length })
  }
  return matches
}

/**
 * Compare a package note to its library match field by field.
 * Statuses: same | fill (library empty, package has content) | conflict.
 * `fieldMap` ({libraryField: packageField}) says which package field feeds each
 * library field; by default fields pair by name. Each comparison row records its
 * source as `pkgName`. Package fields with content that feed nothing are `dropped`.
 */
export function compareFields(pkgFields, libNote, { autoFillEmpty = true } = {}, fieldMap = null) {
  const map = fieldMap ?? defaultFieldMap(Object.keys(pkgFields), libNote.fieldOrder)
  const fields = []
  const used = new Set()
  for (const name of libNote.fieldOrder) {
    const lib = libNote.fields[name] ?? ''
    const pkgName = map[name] && map[name] in pkgFields ? map[name] : ''
    if (pkgName) used.add(pkgName)
    const pkg = pkgName ? pkgFields[pkgName] : undefined
    let status = 'same'
    if (pkg !== undefined && !isEmpty(pkg) && normalizeValue(pkg) !== normalizeValue(lib)) {
      status = isEmpty(lib) && autoFillEmpty ? 'fill' : 'conflict'
    }
    fields.push({ name, pkgName, lib, pkg: pkg ?? '', status })
  }
  const dropped = Object.keys(pkgFields).filter((name) => !used.has(name) && !isEmpty(pkgFields[name]))
  return { fields, dropped }
}

export function newTags(pkgTags, libTags) {
  const have = new Set(libTags.map((t) => t.toLowerCase()))
  return pkgTags.filter((t) => !have.has(t.toLowerCase()))
}

/**
 * Phase 2: classify every package note against its matched library note.
 *
 * @param pkg       parsed package from the Rust parser
 * @param matches   output of selectMatches()
 * @param libNotes  full normalized library notes for the matched ids
 * @param mapping   {pkgNotetypeId: {modelName, create}} target library model per package notetype
 * @param settings  {autoFillEmpty}
 * @param fieldMaps {pairKey: fieldMap} chosen field maps; pairs without one pair fields by name
 * @param libModelFields {modelName: [fieldNames]}, for new notes added to an existing model
 * @returns array of {kind: new|identical|auto|conflict, ...}. Matched entries carry
 *          `sharedWith`: guids of other package notes matched to the same library note.
 *          Entries written to an existing model carry the `fieldMap` used.
 */
export function analyze({ pkg, matches, libNotes, mapping, settings, fieldMaps = {}, libModelFields = {} }) {
  const notetypes = new Map(pkg.notetypes.map((nt) => [nt.id, nt]))
  const libById = new Map(libNotes.map((n) => [n.id, n]))
  const fieldMapFor = (notetype, modelName, libFields) =>
    fieldMaps[pairKey(notetype.id, modelName)] ?? defaultFieldMap(notetype.fields, libFields)

  const entries = pkg.notes.map((note) => {
    const notetype = notetypes.get(note.notetypeId)
    const target = mapping[note.notetypeId]
    const fields = namedFields(note, notetype)
    const base = { guid: note.guid, pkgNote: note, notetype, target, pkgFields: fields }

    const match = matches.get(note.guid)
    // A note deleted between phases simply comes back unmatched.
    const libNote = match && libById.get(match.libId)
    if (!libNote) {
      const fieldMap = target.create ? null : fieldMapFor(notetype, target.modelName, libModelFields[target.modelName] ?? [])
      return { ...base, kind: 'new', fieldMap }
    }
    const { matchedBy, candidates } = match

    const fieldMap = fieldMapFor(notetype, libNote.modelName, libNote.fieldOrder)
    const { fields: comparison, dropped } = compareFields(fields, libNote, settings, fieldMap)
    const tagsToAdd = newTags(note.tags, libNote.tags)
    const hasConflict = comparison.some((f) => f.status === 'conflict')
    const hasFill = comparison.some((f) => f.status === 'fill')
    const kind = hasConflict ? 'conflict' : hasFill || tagsToAdd.length ? 'auto' : 'identical'

    return {
      ...base,
      kind,
      libNote,
      fieldMap,
      matchedBy,
      ambiguous: candidates > 1,
      fields: comparison,
      dropped,
      tagsToAdd,
      sharedWith: [],
    }
  })

  // Several package notes can land on one library note (e.g. duplicates in the
  // package). Record it so review can warn and the plan can catch disagreements.
  const byTarget = new Map()
  for (const e of entries) {
    if (!e.libNote) continue
    if (!byTarget.has(e.libNote.id)) byTarget.set(e.libNote.id, [])
    byTarget.get(e.libNote.id).push(e)
  }
  for (const group of byTarget.values()) {
    if (group.length < 2) continue
    for (const e of group) e.sharedWith = group.filter((o) => o !== e).map((o) => o.guid)
  }
  return entries
}

/**
 * Identifies what a resolution was made against: the library note's values and
 * which package field fed each of them. A saved decision is only reused while
 * this is unchanged, so editing the note in Anki, a different note matching
 * next time, or remapping a field invalidates it.
 */
export function libraryFingerprint(entry) {
  return [entry.libNote.id, ...entry.fields.map((f) => `${f.pkgName}\u0001${f.lib}`)].join('\u0000')
}

/** Starting merged values: library for same/conflict fields, package for fills. */
export function initialResolution(entry) {
  return {
    status: 'pending',
    lib: libraryFingerprint(entry),
    values: Object.fromEntries(
      entry.fields.map((f) => [f.name, f.status === 'fill' ? f.pkg : f.lib]),
    ),
  }
}

/** Collect media filenames referenced by field HTML: <img src>, [sound:], etc. */
export function mediaReferences(html) {
  const names = new Set()
  // Quoted src values may contain spaces; unquoted ones end at whitespace or '>'.
  for (const m of (html ?? '').matchAll(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    names.add(m[1] ?? m[2] ?? m[3])
  }
  for (const m of (html ?? '').matchAll(/\[sound:([^\]]+)\]/g)) names.add(m[1])
  return [...names]
    .filter((n) => !/^(https?:|data:|blob:)/i.test(n))
    .map((n) => {
      try {
        return decodeURI(n)
      } catch {
        return n
      }
    })
}
