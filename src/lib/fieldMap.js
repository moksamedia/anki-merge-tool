// Field maps: which package field feeds each library field when a package note
// type meets a library note type. Shape: {libraryField: packageField | ''},
// where '' means the library field receives nothing from the package.

/** Session key for a (package note type, library note type) pair. */
export const pairKey = (notetypeId, modelName) => `${notetypeId}\u0000${modelName}`

/** Key used to remember a pair's map across packages: by names, since ids differ per export. */
export const savedPairKey = (notetypeName, modelName) => `${notetypeName}\u0000${modelName}`

/** The package field named like a library field: exact, else case-insensitive ("tibetan" ↔ "Tibetan"). */
export function sameNamedField(pkgFieldNames, libField) {
  if (pkgFieldNames.includes(libField)) return libField
  const lower = libField.toLowerCase()
  return pkgFieldNames.find((name) => name.toLowerCase() === lower)
}

/** Pair every library field with the package field of the same name, if any. */
export function defaultFieldMap(pkgFieldNames, libFieldNames) {
  return Object.fromEntries(libFieldNames.map((lib) => [lib, sameNamedField(pkgFieldNames, lib) ?? '']))
}

/**
 * A remembered map, made valid for the current fields: entries naming a field
 * that no longer exists, and library fields the saved map doesn't cover, fall
 * back to the same-name default.
 */
export function reconcileFieldMap(saved, pkgFieldNames, libFieldNames) {
  const fallback = defaultFieldMap(pkgFieldNames, libFieldNames)
  if (!saved) return fallback
  return Object.fromEntries(
    libFieldNames.map((lib) => {
      const pkg = saved[lib]
      const valid = pkg === '' || pkgFieldNames.includes(pkg)
      return [lib, valid ? pkg : fallback[lib]]
    }),
  )
}

/** Package fields that no library field takes. */
export function unmappedFields(pkgFieldNames, fieldMap) {
  const used = new Set(Object.values(fieldMap))
  return pkgFieldNames.filter((name) => !used.has(name))
}

/** Package values renamed onto library fields: {libraryField: value}, mapped fields only. */
export function mapFields(pkgFields, fieldMap) {
  return Object.fromEntries(
    Object.entries(fieldMap)
      .filter(([, pkg]) => pkg && pkg in pkgFields)
      .map(([lib, pkg]) => [lib, pkgFields[pkg]]),
  )
}

/**
 * Whether a pair needs the user's attention: the note types differ by name, or
 * the same-name default leaves a field on either side unpaired.
 */
export function needsFieldMap(notetype, modelName, libFieldNames) {
  if (notetype.name !== modelName) return true
  const map = defaultFieldMap(notetype.fields, libFieldNames)
  return Object.values(map).includes('') || unmappedFields(notetype.fields, map).length > 0
}

/**
 * Library notes as they'll look once scheduled new fields exist: each new field
 * appended, empty. `newFields` is {modelName: [fieldName]}.
 */
export function withNewFields(libNotes, newFields) {
  return libNotes.map((note) => {
    const added = (newFields[note.modelName] ?? []).filter((f) => !note.fieldOrder.includes(f))
    if (!added.length) return note
    return {
      ...note,
      fieldOrder: [...note.fieldOrder, ...added],
      fields: { ...note.fields, ...Object.fromEntries(added.map((f) => [f, ''])) },
    }
  })
}
