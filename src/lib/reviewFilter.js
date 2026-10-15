// Filtering Review's lists by package note type, tags and text. Pure — no Vue —
// so it is unit-tested directly.

import { plainText } from './display.js'

/** An empty filter: everything passes. `fields` null means search every field. */
export const emptyFilter = () => ({ notetype: '', tags: [], text: '', fields: null })

export const isFiltering = (filter) => !!(filter.notetype || filter.tags.length || filter.text.trim())

/** Text as searched: no markup, Unicode composition, case or runs of whitespace. */
const searchable = (html) => plainText(html).normalize('NFD').toLowerCase()

/**
 * Whether a note's tags include any of `wanted`. A wanted tag also matches its
 * children in Anki's hierarchy: "Basics" matches "Basics::CommonWords".
 */
export function hasAnyTag(tags, wanted) {
  if (!wanted.length) return true
  const have = tags.map((t) => t.toLowerCase())
  return wanted.some((w) => {
    const lower = w.toLowerCase()
    return have.some((t) => t === lower || t.startsWith(`${lower}::`))
  })
}

/**
 * Whether an entry passes the filter. Text is searched in the package note's
 * fields and in its matched library note's, limited to `filter.fields` (field
 * names, either side) when that is set.
 */
export function entryMatches(entry, filter) {
  if (filter.notetype && String(entry.notetype.id) !== String(filter.notetype)) return false
  if (!hasAnyTag(entry.pkgNote.tags ?? [], filter.tags)) return false
  const needle = filter.text.trim().normalize('NFD').toLowerCase()
  if (!needle) return true
  const wanted = filter.fields ? new Set(filter.fields) : null
  const sources = [entry.pkgFields, entry.libNote?.fields ?? {}]
  return sources.some((fields) =>
    Object.entries(fields).some(([name, html]) => (!wanted || wanted.has(name)) && searchable(html).includes(needle)),
  )
}

/** Every field name a search can look in, package fields first: [{name, pkg, lib}] with which side has it. */
export function searchFields(entries) {
  const byName = new Map()
  const add = (name, side) => {
    if (!byName.has(name)) byName.set(name, { name, pkg: false, lib: false })
    byName.get(name)[side] = true
  }
  for (const e of entries) {
    for (const name of e.notetype.fields) add(name, 'pkg')
    for (const name of e.libNote?.fieldOrder ?? []) add(name, 'lib')
  }
  return [...byName.values()]
}

/** Every package tag on the entries, sorted. */
export function allTags(entries) {
  return [...new Set(entries.flatMap((e) => e.pkgNote.tags ?? []))].sort((a, b) => a.localeCompare(b))
}
