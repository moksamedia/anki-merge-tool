// Matching package notes to library notes and classifying the differences.
// Pure functions — no Anki or Tauri access — so they are unit-tested directly.

/** Normalise a field for equality checks: whitespace and &nbsp; differences don't count. */
export function normalizeValue(value) {
  return (value ?? '')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/<br\s*\/?>/gi, '<br>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Key used to match notes by main field: also ignores markup and case. */
export function matchKey(value) {
  return normalizeValue((value ?? '').replace(/<[^>]*>/g, ' ')).toLowerCase()
}

const isEmpty = (value) => matchKey(value) === '' && !/<img|\[sound:/i.test(value ?? '')

/** Package note fields as {name: value} using its notetype's field order. */
export function namedFields(note, notetype) {
  return Object.fromEntries(notetype.fields.map((name, i) => [name, note.fields[i] ?? '']))
}

/** The field used for matching: the configured main field, else the notetype's first field. */
export function mainFieldName(fieldNames, preferred) {
  const lower = preferred?.trim().toLowerCase()
  return fieldNames.find((f) => f.toLowerCase() === lower) ?? fieldNames[0]
}

/**
 * Index library notes by (model, main-field key) for fallback matching.
 * Several notes can share a key; all are kept so ambiguity can be reported.
 */
export function indexLibraryNotes(libNotes, preferredMainField) {
  const index = new Map()
  for (const note of libNotes) {
    const field = mainFieldName(note.fieldOrder, preferredMainField)
    const key = matchKey(note.fields[field])
    if (!key) continue
    const k = `${note.modelName}\u0000${key}`
    if (!index.has(k)) index.set(k, [])
    index.get(k).push(note)
  }
  return index
}

/**
 * Compare a package note to its library match field by field.
 * Statuses: same | fill (library empty, package has content) | conflict.
 * Package fields absent from the library model are reported as `dropped`.
 */
export function compareFields(pkgFields, libNote, { autoFillEmpty = true } = {}) {
  const fields = []
  for (const name of libNote.fieldOrder) {
    const lib = libNote.fields[name] ?? ''
    const pkg = pkgFields[name]
    let status = 'same'
    if (pkg !== undefined && !isEmpty(pkg) && normalizeValue(pkg) !== normalizeValue(lib)) {
      status = isEmpty(lib) && autoFillEmpty ? 'fill' : 'conflict'
    }
    fields.push({ name, lib, pkg: pkg ?? '', status })
  }
  const dropped = Object.keys(pkgFields).filter(
    (name) => !(name in libNote.fields) && !isEmpty(pkgFields[name]),
  )
  return { fields, dropped }
}

export function newTags(pkgTags, libTags) {
  const have = new Set(libTags.map((t) => t.toLowerCase()))
  return pkgTags.filter((t) => !have.has(t.toLowerCase()))
}

/**
 * Classify every package note.
 *
 * @param pkg       parsed package from the Rust parser
 * @param guidMap   {guid: libraryNoteId} from the bridge
 * @param libNotes  normalized library notes (GUID matches + notes of mapped models)
 * @param mapping   {pkgNotetypeId: {modelName, create}} target library model per package notetype
 * @param settings  {mainField, autoFillEmpty}
 * @returns array of {kind: new|identical|auto|conflict, ...}
 */
export function analyze({ pkg, guidMap, libNotes, mapping, settings }) {
  const notetypes = new Map(pkg.notetypes.map((nt) => [nt.id, nt]))
  const libById = new Map(libNotes.map((n) => [n.id, n]))
  const index = indexLibraryNotes(libNotes, settings.mainField)

  return pkg.notes.map((note) => {
    const notetype = notetypes.get(note.notetypeId)
    const target = mapping[note.notetypeId]
    const fields = namedFields(note, notetype)
    const base = { guid: note.guid, pkgNote: note, notetype, target, pkgFields: fields }

    let libNote = libById.get(guidMap[note.guid])
    let matchedBy = libNote ? 'guid' : null
    let candidates = 0
    // A notetype being created can't have library notes yet, so only GUIDs can match it.
    if (!libNote && !target.create) {
      const key = matchKey(fields[mainFieldName(notetype.fields, settings.mainField)])
      const hits = key ? index.get(`${target.modelName}\u0000${key}`) ?? [] : []
      candidates = hits.length
      libNote = hits[0]
      matchedBy = libNote ? 'field' : null
    }

    if (!libNote) return { ...base, kind: 'new' }

    const { fields: comparison, dropped } = compareFields(fields, libNote, settings)
    const tagsToAdd = newTags(note.tags, libNote.tags)
    const hasConflict = comparison.some((f) => f.status === 'conflict')
    const hasFill = comparison.some((f) => f.status === 'fill')
    const kind = hasConflict ? 'conflict' : hasFill || tagsToAdd.length ? 'auto' : 'identical'

    return {
      ...base,
      kind,
      libNote,
      matchedBy,
      ambiguous: candidates > 1,
      fields: comparison,
      dropped,
      tagsToAdd,
    }
  })
}

/** Starting merged values: library for same/conflict fields, package for fills. */
export function initialResolution(entry) {
  return {
    status: 'pending',
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
