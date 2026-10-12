import { lookupField, mediaReferences, normalizeValue } from './match.js'

const MULTI_CHUNK = 50
const MEDIA_CHUNK = 20

/**
 * The field values an entry has an opinion about: fills for auto-merges; for
 * accepted conflicts, every field that was in conflict or that the user edited.
 * Keeping the library value of a conflicting field counts as an opinion.
 */
function desiredValues(entry, resolutions) {
  if (entry.kind === 'auto') {
    return Object.fromEntries(entry.fields.filter((f) => f.status === 'fill').map((f) => [f.name, f.pkg]))
  }
  const res = resolutions[entry.guid]
  if (entry.kind === 'conflict' && res?.status === 'accepted') {
    return Object.fromEntries(
      entry.fields
        .filter((f) => f.status !== 'same' || res.values[f.name] !== f.lib)
        .map((f) => [f.name, res.values[f.name]]),
    )
  }
  return null
}

/**
 * Turn analysis results + review decisions into concrete writes.
 *
 * Everything aimed at one library note is merged into a single update, so two
 * package notes matching the same library note can't silently overwrite each
 * other: where they want different values for a field, the plan reports a
 * collision instead, and the UI blocks applying until it is resolved.
 *
 * @param entries      output of analyze()
 * @param resolutions  {guid: {status, values}} for conflict entries
 * @param excluded     Set of guids the user excluded (auto-merges and new notes)
 * @param libModelFields {modelName: [fieldNames]} for existing library models
 */
export function buildPlan({ pkg, entries, resolutions, excluded, libModelFields, targetDeck }) {
  const newNotes = []
  const modelsUsed = new Map()
  const targets = new Map()
  const collisions = new Map()

  for (const entry of entries) {
    if (excluded.has(entry.guid)) continue

    if (entry.kind === 'new') {
      const { modelName, create } = entry.target
      const allowed = create ? entry.notetype.fields : libModelFields[modelName] ?? []
      const fields = {}
      for (const name of allowed) {
        const pkgName = lookupField(entry.pkgFields, name)
        if (pkgName) fields[name] = entry.pkgFields[pkgName]
      }
      if (create) modelsUsed.set(modelName, entry.notetype)
      newNotes.push({ guid: entry.guid, deckName: targetDeck, modelName, fields, tags: entry.pkgNote.tags })
      continue
    }

    const desired = desiredValues(entry, resolutions)
    if (!desired) continue

    const id = entry.libNote.id
    if (!targets.has(id)) targets.set(id, { id, guids: [], want: {}, lib: {}, tags: new Map() })
    const target = targets.get(id)
    target.guids.push(entry.guid)
    for (const f of entry.fields) target.lib[f.name] = f.lib
    for (const tag of entry.tagsToAdd) target.tags.set(tag.toLowerCase(), tag)

    for (const [name, value] of Object.entries(desired)) {
      const prev = target.want[name]
      if (!prev) {
        target.want[name] = { value, guid: entry.guid }
      } else if (normalizeValue(prev.value) !== normalizeValue(value)) {
        const key = `${id}\u0000${name}`
        if (!collisions.has(key)) collisions.set(key, { id, field: name, values: [{ guid: prev.guid, value: prev.value }] })
        collisions.get(key).values.push({ guid: entry.guid, value })
      }
    }
  }

  const updates = []
  const tagAdds = []
  for (const t of targets.values()) {
    const fields = Object.fromEntries(
      Object.entries(t.want)
        .filter(([name, w]) => w.value !== t.lib[name])
        .map(([name, w]) => [name, w.value]),
    )
    if (Object.keys(fields).length) updates.push({ guids: t.guids, id: t.id, fields })
    if (t.tags.size) tagAdds.push({ guids: t.guids, id: t.id, tags: [...t.tags.values()] })
  }

  const modelsToCreate = [...modelsUsed.entries()].map(([modelName, nt]) => ({
    modelName,
    inOrderFields: nt.fields,
    css: nt.css,
    isCloze: nt.isCloze,
    cardTemplates: nt.templates.map((t) => ({ Name: t.name, Front: t.qfmt, Back: t.afmt })),
  }))

  // Only copy media that the written content actually references. Files starting
  // with "_" are notetype assets (fonts, scripts) referenced from templates/CSS.
  const available = new Set(pkg.media)
  const media = new Set()
  for (const html of [...newNotes, ...updates].flatMap((n) => Object.values(n.fields))) {
    for (const name of mediaReferences(html)) if (available.has(name)) media.add(name)
  }
  const modelText = modelsToCreate.map((m) => m.css + m.cardTemplates.map((t) => t.Front + t.Back).join('')).join('')
  for (const name of pkg.media) if (name.startsWith('_') && modelText.includes(name)) media.add(name)

  return { targetDeck, modelsToCreate, media: [...media], newNotes, updates, tagAdds, collisions: [...collisions.values()] }
}

/** Rewrite references to media files Anki stored under a different name. */
export function applyRenames(fields, renames) {
  if (!Object.keys(renames).length) return fields
  return Object.fromEntries(
    Object.entries(fields).map(([name, html]) => {
      let out = html
      for (const [from, to] of Object.entries(renames)) {
        out = out
          .replace(new RegExp(`(src\\s*=\\s*["']?)${escapeRegExp(from)}(?=["'\\s>])`, 'g'), `$1${to}`)
          .replaceAll(`[sound:${from}]`, `[sound:${to}]`)
      }
      return [name, out]
    }),
  )
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function chunks(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function createReport() {
  return {
    backup: null,
    modelsCreated: [],
    media: { stored: 0, renamed: {}, failed: [] },
    added: { ok: 0, failed: [] },
    updated: { ok: 0, failed: [] },
    tagged: { ok: 0, failed: [] },
  }
}

/**
 * Execute a plan against the live collection. The backup must succeed before
 * anything is written; per-item failures are collected rather than aborting.
 *
 * @param client     from createAnkiClient()
 * @param readMedia  (names) => Promise<{name: base64}>
 * @param onProgress (message) => void
 * @param report     filled in place, so callers keep partial results (and the
 *                   backup path) if a later step throws
 */
export async function executePlan(client, plan, { readMedia, onProgress = () => {}, report = createReport() }) {

  if (plan.collisions.length) {
    throw new Error('Some package notes disagree about the same library note — resolve them before applying.')
  }

  onProgress('Creating collection backup…')
  try {
    report.backup = await client.backup()
  } catch (e) {
    throw new Error(`Backup failed — nothing was changed. ${e}`, { cause: e })
  }

  onProgress(`Ensuring deck "${plan.targetDeck}"…`)
  if (plan.newNotes.length) await client.call('createDeck', { deck: plan.targetDeck })

  for (const model of plan.modelsToCreate) {
    onProgress(`Creating note type "${model.modelName}"…`)
    await client.call('createModel', model)
    report.modelsCreated.push(model.modelName)
  }

  const renames = report.media.renamed
  for (const names of chunks(plan.media, MEDIA_CHUNK)) {
    onProgress(`Copying media (${report.media.stored}/${plan.media.length})…`)
    const blobs = await readMedia(names)
    const present = names.filter((n) => blobs[n])
    report.media.failed.push(...names.filter((n) => !blobs[n]).map((name) => ({ name, error: 'missing from package' })))
    // deleteExisting:false makes Anki keep a differing library file and store
    // ours under a new name, which we then rewrite in the note fields.
    const results = await client.multi(
      present.map((filename) => ({
        action: 'storeMediaFile',
        params: { filename, data: blobs[filename], deleteExisting: false },
      })),
    )
    results.forEach((r, i) => {
      if (r.error) return report.media.failed.push({ name: present[i], error: r.error })
      report.media.stored++
      if (r.result && r.result !== present[i]) renames[present[i]] = r.result
    })
  }

  for (const batch of chunks(plan.newNotes, MULTI_CHUNK)) {
    onProgress(`Adding notes (${report.added.ok}/${plan.newNotes.length})…`)
    const results = await client.multi(
      batch.map(({ deckName, modelName, fields, tags }) => ({
        action: 'addNote',
        params: { note: { deckName, modelName, fields: applyRenames(fields, renames), tags } },
      })),
    )
    results.forEach((r, i) => {
      if (r.error) report.added.failed.push({ guid: batch[i].guid, error: r.error })
      else report.added.ok++
    })
  }

  for (const batch of chunks(plan.updates, MULTI_CHUNK)) {
    onProgress(`Updating notes (${report.updated.ok}/${plan.updates.length})…`)
    const results = await client.multi(
      batch.map(({ id, fields }) => ({
        action: 'updateNoteFields',
        params: { note: { id, fields: applyRenames(fields, renames) } },
      })),
    )
    results.forEach((r, i) => {
      if (r.error) report.updated.failed.push({ guid: batch[i].guids.join(', '), error: r.error })
      else report.updated.ok++
    })
  }

  for (const batch of chunks(plan.tagAdds, MULTI_CHUNK)) {
    onProgress(`Merging tags (${report.tagged.ok}/${plan.tagAdds.length})…`)
    const results = await client.multi(
      batch.map(({ id, tags }) => ({ action: 'addTags', params: { notes: [id], tags: tags.join(' ') } })),
    )
    results.forEach((r, i) => {
      if (r.error) report.tagged.failed.push({ guid: batch[i].guids.join(', '), error: r.error })
      else report.tagged.ok++
    })
  }

  onProgress('Done.')
  return report
}
