// Dry-run report: a plain, JSON-serializable description of exactly what a
// merge would write. Built from the same plan executePlan runs, so the two
// can't disagree. Pure — no Vue or Tauri — so it is unit-tested directly.

import { entryLabel } from './display.js'
import { unmappedFields } from './fieldMap.js'

const label = (entry, mainField) =>
  entry?.notetype && entry?.pkgFields ? entryLabel(entry, mainField) : entry?.guid ?? '(unknown)'

/**
 * Why a field gets the value it does: 'fill' (library was empty), 'package'
 * (the package's value was chosen) or 'edited' (a value made in review that is
 * neither side as-is, e.g. combined or hand-edited).
 */
function changeReason(entries, field, to) {
  for (const e of entries) {
    const f = e.fields?.find((x) => x.name === field)
    if (!f) continue
    if (f.status === 'fill' && to === f.pkg) return 'fill'
    if (to === f.pkg) return 'package'
  }
  return 'edited'
}

/**
 * @param pkg            parsed package
 * @param pkgPath        package file path
 * @param settings       {mainField, ignoreGuid, autoFillEmpty}
 * @param entries        output of analyze()
 * @param plan           output of buildPlan()
 * @param resolutions    {guid: {status, values}}
 * @param excluded       Set of excluded guids (including already-merged ones)
 * @param merged         {guid: ledger entry} notes written by an earlier run
 * @param libDecks       existing library deck names
 * @param mapping        {pkgNotetypeId: {modelName, create}}
 * @param fieldMaps      [{package, library, fieldMap}] for note type pairs whose fields don't line up by name
 * @param generatedAt    ISO timestamp (passed in so tests are deterministic)
 */
export function buildDryRun({
  pkg,
  pkgPath,
  settings,
  entries,
  plan,
  resolutions,
  excluded,
  merged = {},
  libDecks,
  mapping,
  fieldMaps = [],
  generatedAt = new Date().toISOString(),
}) {
  const byGuid = new Map(entries.map((e) => [e.guid, e]))
  const libExisting = new Set(libDecks)
  const mainField = settings.mainField

  // ---- notes the merge writes -------------------------------------------
  const newNotes = plan.newNotes.map((n) => ({
    guid: n.guid,
    label: label(byGuid.get(n.guid), mainField),
    deck: n.deckName,
    noteType: n.modelName,
    tags: n.tags,
    fields: n.fields,
  }))

  const tagsById = new Map(plan.tagAdds.map((t) => [t.id, t]))
  const updatesById = new Map(plan.updates.map((u) => [u.id, u]))
  const touchedIds = [...new Set([...updatesById.keys(), ...tagsById.keys()])]
  const updates = touchedIds.map((id) => {
    const update = updatesById.get(id)
    const tagAdd = tagsById.get(id)
    const guids = (update ?? tagAdd).guids
    const sources = guids.map((g) => byGuid.get(g)).filter(Boolean)
    const first = sources[0]
    return {
      libNoteId: id,
      label: label(first, mainField),
      noteType: first?.libNote?.modelName ?? update?.modelName,
      matchedBy: first?.matchedBy,
      via: guids,
      changes: Object.entries(update?.fields ?? {}).map(([field, to]) => ({
        field,
        from: first?.fields?.find((f) => f.name === field)?.lib ?? '',
        to,
        reason: changeReason(sources, field, to),
      })),
      tagsAdded: tagAdd?.tags ?? [],
    }
  })

  // ---- notes the merge leaves alone --------------------------------------
  const writtenGuids = new Set([...newNotes.map((n) => n.guid), ...updates.flatMap((u) => u.via)])
  const skipped = []
  let unchanged = 0
  for (const e of entries) {
    if (writtenGuids.has(e.guid)) continue
    if (e.kind === 'identical' && !excluded.has(e.guid)) {
      unchanged++
      continue
    }
    const status = resolutions[e.guid]?.status
    const reason = merged[e.guid]
      ? 'merged'
      : excluded.has(e.guid)
      ? 'excluded'
      : e.kind === 'conflict' && status === 'skipped'
        ? 'skipped'
        : e.kind === 'conflict' && status !== 'accepted'
          ? 'undecided'
          : 'no change'
    skipped.push({ guid: e.guid, label: label(e, mainField), kind: e.kind, reason })
  }

  // ---- warnings ----------------------------------------------------------
  const warnings = []
  for (const e of entries) {
    if (excluded.has(e.guid)) continue
    const l = label(e, mainField)
    if (e.ambiguous) warnings.push({ kind: 'ambiguous', guid: e.guid, label: l, detail: 'Several library notes share this main field; the first match is used.' })
    if (e.sharedWith?.length) warnings.push({ kind: 'shared', guid: e.guid, label: l, detail: `Matches the same library note as ${e.sharedWith.length} other package note(s).` })
    if (e.dropped?.length) warnings.push({ kind: 'dropped', guid: e.guid, label: l, detail: `Package content not merged (no matching library field): ${e.dropped.join(', ')}` })
  }
  const collisions = plan.collisions.map((c) => ({
    libNoteId: c.id,
    field: c.field,
    values: c.values.map((v) => ({ guid: v.guid, label: label(byGuid.get(v.guid), mainField), value: v.value })),
  }))

  // ---- decks and note types ----------------------------------------------
  const deckCounts = new Map()
  for (const n of plan.newNotes) deckCounts.set(n.deckName, (deckCounts.get(n.deckName) ?? 0) + 1)
  const decks = {
    mode: plan.deckMode,
    target: plan.deckMode === 'single' ? plan.targetDeck : null,
    used: plan.decks.map((name) => ({ name, newNotes: deckCounts.get(name) ?? 0, exists: libExisting.has(name) })),
    create: plan.decks.filter((d) => !libExisting.has(d)),
  }

  const notesPerType = new Map()
  for (const n of pkg.notes) notesPerType.set(n.notetypeId, (notesPerType.get(n.notetypeId) ?? 0) + 1)
  const noteTypes = {
    targets: pkg.notetypes
      .filter((nt) => notesPerType.has(nt.id) && mapping[nt.id])
      .map((nt) => ({
        package: nt.name,
        library: mapping[nt.id].modelName,
        create: mapping[nt.id].create,
        notes: notesPerType.get(nt.id),
      })),
    create: plan.modelsToCreate.map((m) => ({
      name: m.modelName,
      fields: m.inOrderFields,
      templates: m.cardTemplates.map((t) => t.Name),
      cloze: m.isCloze,
    })),
    addFields: plan.fieldsToCreate,
    fieldMaps: fieldMaps.map((p) => ({
      package: p.package,
      library: p.library,
      fieldMap: p.fieldMap,
      unmapped: unmappedFields(p.packageFields ?? [], p.fieldMap),
    })),
  }

  // ---- ordered steps, mirroring executePlan ------------------------------
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const steps = ['Create a full collection backup; stop without changing anything if it fails']
  if (decks.used.length) {
    steps.push(`Ensure ${plural(decks.used.length, 'deck')} exist${decks.create.length ? ` (${decks.create.length} new)` : ''}`)
  }
  for (const m of noteTypes.create) steps.push(`Create note type "${m.name}"`)
  for (const f of plan.fieldsToCreate) steps.push(`Add field "${f.fieldName}" to note type "${f.modelName}"`)
  if (plan.media.length) steps.push(`Copy ${plural(plan.media.length, 'media file')} (differing library files are kept; ours are renamed)`)
  if (newNotes.length) steps.push(`Add ${plural(newNotes.length, 'new note')}`)
  if (plan.updates.length) steps.push(`Update fields on ${plural(plan.updates.length, 'note')}`)
  if (plan.tagAdds.length) steps.push(`Add tags to ${plural(plan.tagAdds.length, 'note')}`)

  // ---- summary -----------------------------------------------------------
  const kinds = { new: 0, identical: 0, auto: 0, conflict: 0 }
  for (const e of entries) kinds[e.kind]++
  const conflictStatus = { accepted: 0, skipped: 0, undecided: 0 }
  for (const e of entries) {
    if (e.kind !== 'conflict' || excluded.has(e.guid)) continue
    const s = resolutions[e.guid]?.status
    conflictStatus[s === 'accepted' ? 'accepted' : s === 'skipped' ? 'skipped' : 'undecided']++
  }

  const file = pkgPath ? pkgPath.split(/[\\/]/).pop() : null
  return {
    generatedAt,
    package: { path: pkgPath, file, format: pkg.format, notes: pkg.notes.length, mediaFiles: pkg.media.length },
    settings: {
      mainField,
      ignoreGuid: !!settings.ignoreGuid,
      autoFillEmpty: !!settings.autoFillEmpty,
      deckMode: plan.deckMode,
      targetDeck: decks.target,
      mergeTag: plan.mergeTag || null,
    },
    summary: {
      analysis: kinds,
      conflicts: conflictStatus,
      excluded: [...excluded].filter((g) => !merged[g]).length,
      alreadyMerged: Object.keys(merged).length,
      notesAdded: newNotes.length,
      notesUpdated: plan.updates.length,
      notesTagged: plan.tagAdds.length,
      fieldsChanged: updates.reduce((n, u) => n + u.changes.length, 0),
      decksCreated: decks.create.length,
      noteTypesCreated: noteTypes.create.length,
      fieldsCreated: plan.fieldsToCreate.length,
      mediaFiles: plan.media.length,
      unchanged,
      warnings: warnings.length,
      collisions: collisions.length,
    },
    steps,
    decks,
    noteTypes,
    mergeTag: plan.mergeTag || null,
    media: [...plan.media].sort(),
    newNotes,
    updates,
    skipped,
    warnings,
    collisions,
  }
}
