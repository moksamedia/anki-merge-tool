import { mainFieldName } from './match.js'

/** Field HTML as one line of plain text. */
export const plainText = (html) => (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A one-line glimpse of a note's text: its non-empty fields other than the main
 * one, in order. Sounds and images are left out (show them with MediaStrip)
 * and a bare URL shows as its host. `fields` is {name: html}.
 */
export function fieldsGlimpse(fields, preferredMainField, max = 160) {
  const main = preferredMainField?.trim().toLowerCase()
  const text = Object.entries(fields ?? {})
    .filter(([name]) => name.toLowerCase() !== main)
    .map(([, html]) =>
      plainText((html ?? '').replace(/\[sound:[^\]]*\]/g, ' ').replace(/<img[^>]*>/gi, ' ')).replace(
        /\bhttps?:\/\/([^/\s]+)\S*/gi,
        (_, host) => `${host.replace(/^www\./, '')} ↗`,
      ),
    )
    .filter(Boolean)
    .join(' · ')
  if (!text) {
    const hasMedia = Object.values(fields ?? {}).some((html) => /\[sound:|<img/i.test(html ?? ''))
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
