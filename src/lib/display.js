import { mainFieldName } from './match.js'

/** Field HTML as one line of plain text. */
export const plainText = (html) => (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** A field's text for a summary: sounds and images left out (MediaStrip shows them), a bare URL as its host. */
function summaryText(html) {
  return plainText((html ?? '').replace(/\[_?sound:[^\]]*\]/g, ' ').replace(/<img[^>]*>/gi, ' ')).replace(
    /\bhttps?:\/\/([^/\s]+)\S*/gi,
    (_, host) => `${host.replace(/^www\./, '')} ↗`,
  )
}

/**
 * A note's text fields other than the main one, in order, for a summary:
 * [{name, text}], empty and media-only fields left out, long values cut at `max`.
 * `fields` is {name: html}.
 */
export function summaryFields(fields, preferredMainField, max = 240) {
  const main = preferredMainField?.trim().toLowerCase()
  return Object.entries(fields ?? {})
    .filter(([name]) => name.toLowerCase() !== main)
    .map(([name, html]) => ({ name, text: summaryText(html) }))
    .filter((f) => f.text)
    .map((f) => (f.text.length > max ? { ...f, text: `${f.text.slice(0, max)}…` } : f))
}

/**
 * A one-line glimpse of a note's text: its non-empty fields other than the main
 * one, in order, as summaryText shows them. `fields` is {name: html}.
 */
export function fieldsGlimpse(fields, preferredMainField, max = 160) {
  const text = summaryFields(fields, preferredMainField, Infinity)
    .map((f) => f.text)
    .join(' · ')
  if (!text) {
    const hasMedia = Object.values(fields ?? {}).some((html) => /\[_?sound:|<img/i.test(html ?? ''))
    return hasMedia ? '' : '(no other fields filled)'
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Plain-text main-field value of a package entry, for lists and headings. */
export function entryLabel(entry, preferredMainField) {
  const field = mainFieldName(entry.notetype.fields, preferredMainField)
  return plainText(entry.pkgFields[field]) || `(empty ${field})`
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'])
// Anki plays [sound:] references, which can also be video files; their audio plays.
const AUDIO_EXT = new Set(['mp3', 'ogg', 'oga', 'opus', 'wav', 'm4a', 'aac', 'flac', 'spx', 'webm', 'mp4', '3gp'])

/** 'image' | 'audio' for a media filename, or null for other files. */
export function mediaKind(name) {
  const ext = name.split('.').pop().toLowerCase()
  return IMAGE_EXT.has(ext) ? 'image' : AUDIO_EXT.has(ext) ? 'audio' : null
}

export const STATUS_LABEL = { same: 'identical', fill: 'fills empty', conflict: 'conflict' }
