// Field HTML prepared for display: sanitized, with media resolved to data URLs.
// Shared by the read-only preview and the editable field view.
import DOMPurify from 'dompurify'

export const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/**
 * @param html        raw field HTML
 * @param source      'pkg' | 'lib' | 'result', see resolveMedia
 * @param resolveMedia (name, source) => Promise<dataUrl | null>
 * @param sounds      'player': [sound:x] becomes an <audio>; 'text': left as text, as Anki's editor shows it
 * @param missing     'placeholder': an unresolvable image becomes a "missing image" note;
 *                    'keep': it stays an <img> (so an editor can round-trip it unchanged)
 * @returns body HTML. Images carry data-name (their media filename) so the
 *          editor can turn data URLs back into filenames.
 */
export async function prepareFieldHtml(html, source, resolveMedia, { sounds = 'player', missing = 'placeholder' } = {}) {
  const withSounds =
    sounds === 'player'
      ? (html ?? '').replace(/\[_?sound:([^\]]+)\]/g, (_, name) => `<span class="sound" data-name="${escapeHtml(name)}">🔊 ${escapeHtml(name)}</span>`)
      : (html ?? '')
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(withSounds), 'text/html')

  // Sounds become players; added after sanitizing, from files we resolved ourselves.
  await Promise.all(
    [...doc.querySelectorAll('span.sound[data-name]')].map(async (span) => {
      const url = await resolveMedia(span.dataset.name, source)
      if (!url) return span.classList.add('missing')
      const audio = Object.assign(doc.createElement('audio'), { controls: true, preload: 'metadata', src: url, title: span.dataset.name })
      span.replaceWith(audio)
    }),
  )
  await Promise.all(
    [...doc.querySelectorAll('img')].map(async (img) => {
      const src = img.getAttribute('src') ?? ''
      if (/^(https?|data):/i.test(src)) return
      let name = src
      try {
        name = decodeURI(src)
      } catch {
        // keep the raw value
      }
      const url = await resolveMedia(name, source)
      img.dataset.name = name
      if (url) img.setAttribute('src', url)
      else if (missing === 'placeholder') {
        img.replaceWith(Object.assign(doc.createElement('span'), { className: 'missing', textContent: `missing image: ${name}` }))
      } else img.setAttribute('alt', name)
    }),
  )
  return doc.body.innerHTML
}

/** The editor's DOM back to field HTML: data URLs become media filenames again. */
export function editorHtml(root) {
  const copy = root.cloneNode(true)
  for (const br of copy.querySelectorAll('br[data-sentinel]')) br.remove()
  for (const img of copy.querySelectorAll('img[data-name]')) {
    img.setAttribute('src', img.dataset.name)
    img.removeAttribute('data-name')
    if (img.getAttribute('alt') === img.getAttribute('src')) img.removeAttribute('alt')
  }
  return copy.innerHTML
}
