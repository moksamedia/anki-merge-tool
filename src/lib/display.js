import { mainFieldName } from './match.js'

/** Field HTML as one line of plain text. */
export const plainText = (html) => (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Plain-text main-field value of a package entry, for lists and headings. */
export function entryLabel(entry, preferredMainField) {
  const field = mainFieldName(entry.notetype.fields, preferredMainField)
  return plainText(entry.pkgFields[field]) || `(empty ${field})`
}

export const STATUS_LABEL = { same: 'identical', fill: 'fills empty', conflict: 'conflict' }
