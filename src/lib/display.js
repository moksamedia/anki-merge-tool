import { mainFieldName } from './match.js'

/** Plain-text main-field value of a package entry, for lists and headings. */
export function entryLabel(entry, preferredMainField) {
  const field = mainFieldName(entry.notetype.fields, preferredMainField)
  const text = (entry.pkgFields[field] ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim()
  return text || `(empty ${field})`
}

export const STATUS_LABEL = { same: 'identical', fill: 'fills empty', conflict: 'conflict' }
