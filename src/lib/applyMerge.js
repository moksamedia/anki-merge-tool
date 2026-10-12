import { mediaReferences } from './match.js'

const MULTI_CHUNK = 50
const MEDIA_CHUNK = 20

/**
 * Turn analysis results + review decisions into concrete writes.
 *
 * @param entries      output of analyze()
 * @param resolutions  {guid: {status, values}} for conflict entries
 * @param excluded     Set of guids the user excluded (auto-merges and new notes)
 * @param libModelFields {modelName: [fieldNames]} for existing library models
 */
export function buildPlan({ pkg, entries, resolutions, excluded, libModelFields, targetDeck }) {
  const newNotes = []
  const updates = []
  const tagAdds = []
  const modelsUsed = new Map()

  for (const entry of entries) {
    if (excluded.has(entry.guid)) continue

    if (entry.kind === 'new') {
      const { modelName, create } = entry.target
      const allowed = create ? entry.notetype.fields : libModelFields[modelName] ?? []
      const fields = Object.fromEntries(
        Object.entries(entry.pkgFields).filter(([name]) => allowed.includes(name)),
      )
      if (create) modelsUsed.set(modelName, entry.notetype)
      newNotes.push({ guid: entry.guid, deckName: targetDeck, modelName, fields, tags: entry.pkgNote.tags })
      continue
    }

    let changed = {}
    if (entry.kind === 'auto') {
      for (const f of entry.fields) if (f.status === 'fill') changed[f.name] = f.pkg
    } else if (entry.kind === 'conflict') {
      const res = resolutions[entry.guid]
      if (res?.status !== 'accepted') continue
      for (const f of entry.fields) {
        if (res.values[f.name] !== f.lib) changed[f.name] = res.values[f.name]
      }
    } else {
      continue
    }

    if (Object.keys(changed).length) updates.push({ guid: entry.guid, id: entry.libNote.id, fields: changed })
    if (entry.tagsToAdd.length) tagAdds.push({ guid: entry.guid, id: entry.libNote.id, tags: entry.tagsToAdd })
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

  return { targetDeck, modelsToCreate, media: [...media], newNotes, updates, tagAdds }
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
      if (r.error) report.updated.failed.push({ guid: batch[i].guid, error: r.error })
      else report.updated.ok++
    })
  }

  for (const batch of chunks(plan.tagAdds, MULTI_CHUNK)) {
    onProgress(`Merging tags (${report.tagged.ok}/${plan.tagAdds.length})…`)
    const results = await client.multi(
      batch.map(({ id, tags }) => ({ action: 'addTags', params: { notes: [id], tags: tags.join(' ') } })),
    )
    results.forEach((r, i) => {
      if (r.error) report.tagged.failed.push({ guid: batch[i].guid, error: r.error })
      else report.tagged.ok++
    })
  }

  onProgress('Done.')
  return report
}
