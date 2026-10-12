// The merge session: everything a package's review needs to be resumed later,
// saved as a JSON sidecar next to the package (`<name>.apkg.merge.json`), plus
// the ledger of package notes already written to the library. Pure — no Vue or
// Tauri — so it is unit-tested directly.

export const SESSION_VERSION = 1

/** Where a package's session file lives: next to it. */
export const sessionPath = (pkgPath) => `${pkgPath}.merge.json`

/**
 * The record to write for the current state.
 *
 * Decisions for merged notes are dropped: a merged note is read-only, and its
 * written values are in the ledger.
 */
export function buildSession({ state, settings, savedAt = new Date().toISOString() }) {
  const merged = state.merged ?? {}
  return {
    version: SESSION_VERSION,
    package: state.pkgPath,
    savedAt,
    settings: {
      mainField: settings.mainField,
      ignoreGuid: !!settings.ignoreGuid,
      autoFillEmpty: !!settings.autoFillEmpty,
    },
    config: {
      deckMode: state.deckMode,
      targetDeck: state.targetDeck,
      mergeTag: state.mergeTag,
      mapping: state.mapping,
      fieldMaps: state.fieldMaps,
      newFields: state.newFields,
    },
    decisions: Object.fromEntries(Object.entries(state.resolutions ?? {}).filter(([guid]) => !merged[guid])),
    excluded: [...(state.excluded ?? [])],
    merged,
    runs: state.runs ?? [],
  }
}

/** A session record from file text, or null if the text is missing or not one. */
export function parseSession(text) {
  if (!text) return null
  try {
    const record = JSON.parse(text)
    return record && typeof record === 'object' && record.version === SESSION_VERSION ? record : null
  } catch {
    return null
  }
}

/**
 * The state fragments a saved session restores, checked against the package
 * and the library as they are now.
 *
 * `mapping` only covers package note types whose saved target still makes
 * sense; the caller fills the rest with its defaults. A remembered "create"
 * whose type now exists maps onto it instead (an earlier run created it).
 */
export function restoreSession(record, { pkg, libModels }) {
  const config = record.config ?? {}
  const mapping = {}
  for (const nt of pkg.notetypes) {
    const m = config.mapping?.[nt.id]
    if (!m?.modelName) continue
    const exists = libModels.includes(m.modelName)
    if (m.create || exists) mapping[nt.id] = { modelName: m.modelName, create: !exists }
  }
  return {
    settings: {
      mainField: record.settings?.mainField,
      ignoreGuid: record.settings?.ignoreGuid,
      autoFillEmpty: record.settings?.autoFillEmpty,
    },
    deckMode: config.deckMode === 'package' ? 'package' : config.deckMode === 'single' ? 'single' : null,
    targetDeck: typeof config.targetDeck === 'string' ? config.targetDeck : null,
    mergeTag: typeof config.mergeTag === 'string' ? config.mergeTag : null,
    mapping,
    fieldMaps: config.fieldMaps ?? {},
    newFields: config.newFields ?? {},
    resolutions: record.decisions ?? {},
    excluded: new Set(record.excluded ?? []),
    merged: record.merged ?? {},
    runs: record.runs ?? [],
  }
}

/** Counts for a Recent-list line: how far a saved session got. */
export function sessionSummary(record) {
  const decisions = Object.values(record.decisions ?? {})
  return {
    savedAt: record.savedAt ?? null,
    decided: decisions.filter((d) => d.status && d.status !== 'pending').length,
    pending: decisions.filter((d) => !d.status || d.status === 'pending').length,
    merged: Object.keys(record.merged ?? {}).length,
    runs: (record.runs ?? []).length,
  }
}

/** Per-item failures of a run, flattened for display and for the run log. */
export function runFailures(report) {
  if (!report) return []
  return [
    ...report.media.failed.map((f) => ({ what: `media ${f.name}`, error: f.error })),
    ...report.added.failed.map((f) => ({ what: `add ${f.guid}`, error: f.error })),
    ...report.updated.failed.map((f) => ({ what: `update ${f.guid}`, error: f.error })),
    ...report.tagged.failed.map((f) => ({ what: `tags ${f.guid}`, error: f.error })),
  ]
}

/**
 * What a run merged, from the plan it ran and the report executePlan filled.
 *
 * A package note counts as merged when its field write landed — the note was
 * added, or the library note it targets was updated — or, when it had no
 * field write planned (tags only), when its tags were added. Anything that
 * failed stays unmerged, so it is still approved and goes into the next run.
 *
 * @returns {merged: {guid: ledgerEntry}, run: summary}
 */
export function mergedFromRun({ plan, report, entries, at = new Date().toISOString(), run = 1 }) {
  const byGuid = new Map(entries.map((e) => [e.guid, e]))
  const planned = new Map(plan.newNotes.map((n) => [n.guid, n]))
  const merged = {}

  for (const { guid, id, fields } of report.added.notes) {
    const n = planned.get(guid)
    merged[guid] = {
      at,
      run,
      kind: 'new',
      libNoteId: id,
      modelName: n?.modelName ?? null,
      deck: n?.deckName ?? null,
      // The report's fields are as written (media renamed); the plan's are the fallback.
      fields: fields ?? n?.fields ?? {},
      tags: n?.tags ?? [],
    }
  }

  for (const u of report.updated.notes) {
    for (const guid of u.guids) {
      merged[guid] = {
        at,
        run,
        kind: byGuid.get(guid)?.kind ?? 'conflict',
        libNoteId: u.id,
        modelName: byGuid.get(guid)?.libNote?.modelName ?? null,
        deck: null,
        fields: u.fields,
        tags: [],
      }
    }
  }

  const fieldWritePlanned = new Set(plan.updates.flatMap((u) => u.guids))
  for (const t of report.tagged.notes) {
    for (const guid of t.guids) {
      if (merged[guid]) {
        merged[guid].tags = t.tags
      } else if (!fieldWritePlanned.has(guid)) {
        merged[guid] = {
          at,
          run,
          kind: byGuid.get(guid)?.kind ?? 'auto',
          libNoteId: t.id,
          modelName: byGuid.get(guid)?.libNote?.modelName ?? null,
          deck: null,
          fields: {},
          tags: t.tags,
        }
      }
    }
  }

  const summary = {
    at,
    run,
    backup: report.backup?.file ?? null,
    added: report.added.ok,
    updated: report.updated.ok,
    tagged: report.tagged.ok,
    merged: Object.keys(merged).length,
    modelsCreated: [...report.modelsCreated],
    fieldsCreated: report.fieldsCreated.map((f) => `${f.fieldName} → ${f.modelName}`),
    mediaStored: report.media.stored,
    failures: runFailures(report),
  }
  return { merged, run: summary }
}

/**
 * Force merged package notes onto the library notes they were written to.
 *
 * Added notes get fresh GUIDs in Anki, so a plain re-analysis would only find
 * them by main field (or not at all). The ledger knows their ids.
 */
export function mergedMatches(matches, merged) {
  const out = new Map(matches)
  for (const [guid, m] of Object.entries(merged ?? {})) {
    if (m.libNoteId != null) out.set(guid, { libId: m.libNoteId, matchedBy: 'merged', candidates: 1 })
  }
  return out
}
