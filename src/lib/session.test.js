import { describe, expect, it } from 'vitest'
import { createReport } from './applyMerge.js'
import {
  buildSession,
  mergedFromRun,
  mergedMatches,
  parseSession,
  restoreSession,
  runFailures,
  sessionPath,
  sessionSummary,
} from './session.js'

const pkg = { notetypes: [{ id: 1, name: 'Vocab' }, { id: 2, name: 'Cloze' }] }
const settings = { mainField: 'Tibetan', ignoreGuid: false, autoFillEmpty: true, resultMode: 'editor' }

const state = {
  pkgPath: '/x/deck.apkg',
  deckMode: 'package',
  targetDeck: 'Ocean',
  mergeTag: 'merge_2026-10-12_1300',
  mapping: { 1: { modelName: 'Vocab', create: false }, 2: { modelName: 'Cloze', create: true } },
  fieldMaps: { '1\u00000Vocab': { Front: 'Front' } },
  newFields: { Vocab: ['Audio'] },
  resolutions: {
    c1: { status: 'accepted', lib: 'fp1', values: { Front: 'a' } },
    c2: { status: 'pending', lib: 'fp2', values: { Front: 'b' } },
    m1: { status: 'accepted', lib: 'fp3', values: { Front: 'c' } },
  },
  accepted: new Set(['n2', 'm1']),
  merged: { m1: { at: 't', run: 1, kind: 'conflict', libNoteId: 300, fields: { Front: 'c' }, tags: [] } },
  runs: [{ at: 't', run: 1 }],
}

describe('sessionPath', () => {
  it('is the sidecar next to the package', () => {
    expect(sessionPath('/x/deck.apkg')).toBe('/x/deck.apkg.merge.json')
  })
})

describe('buildSession / restoreSession', () => {
  it('round-trips the state, minus decisions for merged notes', () => {
    const record = buildSession({ state, settings, savedAt: 'now' })
    expect(record.version).toBe(1)
    expect(record.package).toBe('/x/deck.apkg')
    expect(record.settings).toEqual({ mainField: 'Tibetan', ignoreGuid: false, autoFillEmpty: true })
    expect(Object.keys(record.decisions)).toEqual(['c1', 'c2'])
    expect(record.accepted).toEqual(['n2']) // merged m1 dropped

    const parsed = parseSession(JSON.stringify(record))
    const restored = restoreSession(parsed, { pkg, libModels: ['Vocab'] })
    expect(restored.settings).toEqual({ mainField: 'Tibetan', ignoreGuid: false, autoFillEmpty: true })
    expect(restored.deckMode).toBe('package')
    expect(restored.targetDeck).toBe('Ocean')
    expect(restored.mergeTag).toBe('merge_2026-10-12_1300')
    expect(restored.mapping).toEqual(state.mapping)
    expect(restored.fieldMaps).toEqual(state.fieldMaps)
    expect(restored.newFields).toEqual(state.newFields)
    expect(restored.resolutions).toEqual({ c1: state.resolutions.c1, c2: state.resolutions.c2 })
    expect(restored.accepted).toEqual(new Set(['n2']))
    expect(restored.merged).toEqual(state.merged)
    expect(restored.runs).toEqual(state.runs)
  })

  it('drops a mapping whose library type is gone, and maps a remembered "create" onto a type that now exists', () => {
    const record = buildSession({ state, settings })
    const restored = restoreSession(record, { pkg, libModels: ['Cloze'] })
    expect(restored.mapping).toEqual({ 2: { modelName: 'Cloze', create: false } })
  })

  it('restores a record saved before opt-in merging with nothing accepted', () => {
    const old = { version: 1, decisions: {}, excluded: ['n2'] }
    expect(restoreSession(old, { pkg, libModels: [] }).accepted).toEqual(new Set())
  })

  it('tolerates a sparse or partly invalid record', () => {
    const restored = restoreSession({ version: 1, config: { deckMode: 'weird' } }, { pkg, libModels: [] })
    expect(restored.deckMode).toBeNull()
    expect(restored.targetDeck).toBeNull()
    expect(restored.mapping).toEqual({})
    expect(restored.resolutions).toEqual({})
    expect(restored.accepted.size).toBe(0)
    expect(restored.merged).toEqual({})
  })
})

describe('parseSession', () => {
  it('rejects missing, malformed and foreign records', () => {
    expect(parseSession(null)).toBeNull()
    expect(parseSession('')).toBeNull()
    expect(parseSession('{not json')).toBeNull()
    expect(parseSession('{"version": 2}')).toBeNull()
    expect(parseSession('[]')).toBeNull()
  })
})

describe('sessionSummary', () => {
  it('counts decided, pending and merged notes', () => {
    const record = buildSession({ state, settings, savedAt: 'now' })
    expect(sessionSummary(record)).toEqual({ savedAt: 'now', decided: 1, pending: 1, accepted: 1, merged: 1, runs: 1 })
  })
})

describe('mergedFromRun', () => {
  const entries = [
    { guid: 'n1', kind: 'new' },
    { guid: 'n2', kind: 'new' },
    { guid: 'a1', kind: 'auto', libNote: { id: 100, modelName: 'Vocab' } },
    { guid: 'a2', kind: 'auto', libNote: { id: 150, modelName: 'Vocab' } },
    { guid: 'c1', kind: 'conflict', libNote: { id: 200, modelName: 'Vocab' } },
    { guid: 'c2', kind: 'conflict', libNote: { id: 200, modelName: 'Vocab' } },
  ]
  const plan = {
    newNotes: [
      { guid: 'n1', deckName: 'D', modelName: 'Vocab', fields: { Front: 'x' }, tags: ['t'] },
      { guid: 'n2', deckName: 'D', modelName: 'Vocab', fields: { Front: 'y' }, tags: [] },
    ],
    updates: [
      { guids: ['a1'], id: 100, modelName: 'Vocab', fields: { Back: 'filled' } },
      { guids: ['c1', 'c2'], id: 200, modelName: 'Vocab', fields: { Front: 'new' } },
    ],
    tagAdds: [
      { guids: ['a1'], id: 100, tags: ['extra', 'merge'] },
      { guids: ['a2'], id: 150, tags: ['only-tags'] },
    ],
  }

  function report() {
    const r = createReport()
    r.backup = { file: '/b.colpkg', created: true }
    r.added.ok = 1
    r.added.notes = [{ guid: 'n1', id: 9001 }]
    r.added.failed = [{ guid: 'n2', error: 'duplicate' }]
    r.updated.ok = 2
    r.updated.notes = plan.updates.map((u) => ({ guids: u.guids, id: u.id, fields: u.fields }))
    r.tagged.ok = 2
    r.tagged.notes = plan.tagAdds.map((t) => ({ guids: t.guids, id: t.id, tags: t.tags }))
    r.modelsCreated = ['Vocab']
    return r
  }

  it('marks added, updated and tag-only notes as merged, with their library ids', () => {
    const { merged, run } = mergedFromRun({ plan, report: report(), entries, at: 'T', run: 2 })
    expect(Object.keys(merged).sort()).toEqual(['a1', 'a2', 'c1', 'c2', 'n1'])
    expect(merged.n1).toMatchObject({ kind: 'new', libNoteId: 9001, deck: 'D', fields: { Front: 'x' }, tags: ['t'], at: 'T', run: 2 })
    expect(merged.a1).toMatchObject({ kind: 'auto', libNoteId: 100, fields: { Back: 'filled' }, tags: ['extra', 'merge'] })
    expect(merged.a2).toMatchObject({ kind: 'auto', libNoteId: 150, fields: {}, tags: ['only-tags'] })
    // Both package notes feeding one library update are merged.
    expect(merged.c1).toMatchObject({ kind: 'conflict', libNoteId: 200, fields: { Front: 'new' } })
    expect(merged.c2.libNoteId).toBe(200)
    expect(run).toMatchObject({ at: 'T', run: 2, backup: '/b.colpkg', added: 1, updated: 2, tagged: 2, merged: 5, modelsCreated: ['Vocab'] })
    expect(run.failures).toEqual([{ what: 'add n2', error: 'duplicate' }])
  })

  it('leaves a failed note unmerged, even if its tags landed', () => {
    const r = report()
    r.updated.notes = r.updated.notes.filter((u) => u.id !== 100)
    r.updated.failed = [{ guid: 'a1', error: 'open in browser' }]
    const { merged } = mergedFromRun({ plan, report: r, entries })
    expect(merged.a1).toBeUndefined()
    expect(merged.n2).toBeUndefined()
  })
})

describe('mergedMatches', () => {
  it('points merged notes at the library notes they were written to', () => {
    const matches = new Map([['a1', { libId: 100, matchedBy: 'guid', candidates: [100] }]])
    const merged = { n1: { libNoteId: 9001 }, a1: { libNoteId: 100 }, x: { libNoteId: null } }
    const out = mergedMatches(matches, merged)
    expect(out.get('n1')).toEqual({ libId: 9001, matchedBy: 'merged', candidates: [9001] })
    expect(out.get('a1')).toEqual({ libId: 100, matchedBy: 'merged', candidates: [100] })
    expect(out.has('x')).toBe(false)
    expect(matches.get('a1').matchedBy).toBe('guid')
  })
})

describe('runFailures', () => {
  it('flattens every failure list', () => {
    const r = createReport()
    r.media.failed = [{ name: 'a.jpg', error: 'missing' }]
    r.tagged.failed = [{ guid: 'g', error: 'nope' }]
    expect(runFailures(r)).toEqual([
      { what: 'media a.jpg', error: 'missing' },
      { what: 'tags g', error: 'nope' },
    ])
    expect(runFailures(null)).toEqual([])
  })
})
