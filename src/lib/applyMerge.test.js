import { describe, expect, it, vi } from 'vitest'
import { applyRenames, buildPlan, defaultMergeTag, executePlan, sanitizeTag } from './applyMerge.js'

const notetype = {
  id: 1,
  name: 'Vocab',
  isCloze: false,
  css: '@font-face { src: url("_tibetan.ttf") }',
  fields: ['Front', 'Back'],
  templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}' }],
}

const pkg = {
  notetypes: [notetype],
  media: ['a.jpg', '_tibetan.ttf', 'unused.png'],
  decks: [
    { id: 1, name: 'Ocean::1 Basics' },
    { id: 2, name: 'Ocean::2 Patterns' },
  ],
}

const entries = [
  {
    kind: 'new',
    guid: 'n1',
    notetype,
    target: { modelName: 'Vocab', create: true },
    pkgFields: { Front: '<img src="a.jpg">', Back: 'b' },
    pkgNote: { tags: ['t'], deckId: 2 },
  },
  {
    kind: 'auto',
    guid: 'a1',
    libNote: { id: 100 },
    fields: [
      { name: 'Front', lib: 'x', pkg: 'x', status: 'same' },
      { name: 'Back', lib: '', pkg: 'filled', status: 'fill' },
    ],
    tagsToAdd: ['extra'],
  },
  {
    kind: 'conflict',
    guid: 'c1',
    libNote: { id: 200 },
    fields: [
      { name: 'Front', lib: 'old', pkg: 'new', status: 'conflict' },
      { name: 'Back', lib: 'same', pkg: 'same', status: 'same' },
    ],
    tagsToAdd: [],
  },
  {
    kind: 'conflict',
    guid: 'c2',
    libNote: { id: 300 },
    fields: [{ name: 'Front', lib: 'keep', pkg: 'other', status: 'conflict' }],
    tagsToAdd: ['ignored'],
  },
]

const resolutions = {
  c1: { status: 'accepted', values: { Front: 'merged', Back: 'same' } },
  c2: { status: 'skipped', values: { Front: 'keep' } },
}

const plan = () =>
  buildPlan({ pkg, entries, resolutions, excluded: new Set(), targetDeck: 'Imported' })

describe('buildPlan', () => {
  it('collects only accepted conflicts and changed fields', () => {
    const p = plan()
    expect(p.newNotes).toHaveLength(1)
    expect(p.updates).toEqual([
      { guids: ['a1'], id: 100, fields: { Back: 'filled' } },
      { guids: ['c1'], id: 200, fields: { Front: 'merged' } },
    ])
    expect(p.tagAdds).toEqual([{ guids: ['a1'], id: 100, tags: ['extra'] }])
    expect(p.collisions).toEqual([])
  })

  it('creates models for new notes and copies only referenced media', () => {
    const p = plan()
    expect(p.modelsToCreate.map((m) => m.modelName)).toEqual(['Vocab'])
    expect(p.media.sort()).toEqual(['_tibetan.ttf', 'a.jpg'])
  })

  it('writes new notes for an existing model through its field map', () => {
    const entry = {
      kind: 'new',
      guid: 'n2',
      notetype,
      target: { modelName: 'Vocab', create: false },
      pkgFields: { Front: 'f', Back: 'b' },
      fieldMap: { front: 'Front', BACK: 'Back', Notes: '' },
      pkgNote: { tags: [] },
    }
    const p = buildPlan({ pkg, entries: [entry], resolutions: {}, excluded: new Set(), targetDeck: 'D' })
    expect(p.newNotes[0].fields).toEqual({ front: 'f', BACK: 'b' })
  })

  it('places new notes in their package decks when deckMode is package', () => {
    const second = { ...entries[0], guid: 'n2', pkgNote: { tags: [], deckId: 1 } }
    const orphan = { ...entries[0], guid: 'n3', pkgNote: { tags: [], deckId: 999 } }
    const p = buildPlan({
      pkg,
      entries: [entries[0], second, orphan],
      resolutions,
      excluded: new Set(),
      deckMode: 'package',
      targetDeck: 'Fallback',
    })
    expect(p.newNotes.map((n) => n.deckName)).toEqual(['Ocean::2 Patterns', 'Ocean::1 Basics', 'Fallback'])
    expect(p.decks).toEqual(['Fallback', 'Ocean::1 Basics', 'Ocean::2 Patterns'])
  })

  it('uses the single target deck by default', () => {
    expect(plan().newNotes.map((n) => n.deckName)).toEqual(['Imported'])
    expect(plan().decks).toEqual(['Imported'])
  })

  it('adds the merge tag to every written note and nothing else', () => {
    const untouched = {
      kind: 'identical',
      guid: 'same',
      libNote: { id: 900 },
      fields: [{ name: 'Front', lib: 'x', pkg: 'x', status: 'same' }],
      tagsToAdd: [],
    }
    const p = buildPlan({
      pkg,
      entries: [...entries, untouched],
      resolutions,
      excluded: new Set(),
      targetDeck: 'D',
      mergeTag: ' merge run 1 ',
    })
    expect(p.mergeTag).toBe('merge_run_1')
    expect(p.newNotes[0].tags).toEqual(['t', 'merge_run_1'])
    // a1: fill + its own tag; c1: field update only → tag entry created; c2 skipped, 'same' untouched.
    expect(p.tagAdds).toEqual([
      { guids: ['a1'], id: 100, tags: ['extra', 'merge_run_1'] },
      { guids: ['c1'], id: 200, tags: ['merge_run_1'] },
    ])
  })

  it('adds no merge tag when blank', () => {
    const p = buildPlan({ pkg, entries, resolutions, excluded: new Set(), targetDeck: 'D', mergeTag: '  ' })
    expect(p.mergeTag).toBe('')
    expect(p.newNotes[0].tags).toEqual(['t'])
    expect(p.tagAdds).toEqual([{ guids: ['a1'], id: 100, tags: ['extra'] }])
  })

  it('honours exclusions', () => {
    const p = buildPlan({ pkg, entries, resolutions, excluded: new Set(['n1', 'a1']), targetDeck: 'D' })
    expect(p.newNotes).toHaveLength(0)
    expect(p.modelsToCreate).toHaveLength(0)
    expect(p.updates.map((u) => u.guids)).toEqual([['c1']])
  })
})

describe('buildPlan with several package notes on one library note', () => {
  const lib = { id: 500 }
  const conflictEntry = (guid, front, tags = []) => ({
    kind: 'conflict',
    guid,
    libNote: lib,
    fields: [
      { name: 'Front', lib: 'old', pkg: front, status: 'conflict' },
      { name: 'Back', lib: '', pkg: '', status: 'same' },
    ],
    tagsToAdd: tags,
  })
  const autoEntry = (guid, back) => ({
    kind: 'auto',
    guid,
    libNote: lib,
    fields: [
      { name: 'Front', lib: 'old', pkg: 'old', status: 'same' },
      { name: 'Back', lib: '', pkg: back, status: 'fill' },
    ],
    tagsToAdd: ['T'],
  })
  const build = (entries, resolutions = {}) =>
    buildPlan({ pkg, entries, resolutions, excluded: new Set(), targetDeck: 'D' })

  it('reports a collision when accepted results disagree on a field', () => {
    const p = build([conflictEntry('x', 'one'), conflictEntry('y', 'two')], {
      x: { status: 'accepted', values: { Front: 'one', Back: '' } },
      y: { status: 'accepted', values: { Front: 'two', Back: '' } },
    })
    expect(p.collisions).toEqual([
      { id: 500, field: 'Front', values: [{ guid: 'x', value: 'one' }, { guid: 'y', value: 'two' }] },
    ])
  })

  it('treats "keep the library value" as a decision that can collide', () => {
    const p = build([conflictEntry('x', 'one'), conflictEntry('y', 'two')], {
      x: { status: 'accepted', values: { Front: 'old', Back: '' } },
      y: { status: 'accepted', values: { Front: 'two', Back: '' } },
    })
    expect(p.collisions.map((c) => c.field)).toEqual(['Front'])
  })

  it('merges compatible changes into one update and one tag call', () => {
    const p = build([conflictEntry('x', 'one', ['a']), autoEntry('y', 'filled'), autoEntry('z', 'filled ')], {
      x: { status: 'accepted', values: { Front: 'one', Back: '' } },
    })
    // x had no say over Back (identical, untouched), so y/z filling it is no disagreement.
    expect(p.collisions).toEqual([])
    expect(p.updates).toEqual([{ guids: ['x', 'y', 'z'], id: 500, fields: { Front: 'one', Back: 'filled' } }])
    expect(p.tagAdds).toEqual([{ guids: ['x', 'y', 'z'], id: 500, tags: ['a', 'T'] }])
    const q = build([autoEntry('y', 'filled'), autoEntry('z', 'filled ')])
    expect(q.collisions).toEqual([]) // whitespace-only difference is not a disagreement
    expect(q.updates).toEqual([{ guids: ['y', 'z'], id: 500, fields: { Back: 'filled' } }])
    expect(q.tagAdds).toEqual([{ guids: ['y', 'z'], id: 500, tags: ['T'] }])
  })

  it('ignores skipped duplicates', () => {
    const p = build([conflictEntry('x', 'one'), conflictEntry('y', 'two')], {
      x: { status: 'accepted', values: { Front: 'one', Back: '' } },
      y: { status: 'skipped', values: { Front: 'two', Back: '' } },
    })
    expect(p.collisions).toEqual([])
    expect(p.updates).toEqual([{ guids: ['x'], id: 500, fields: { Front: 'one' } }])
  })
})

describe('merge tag helpers', () => {
  it('formats the default tag without spaces or colons', () => {
    expect(defaultMergeTag(new Date(2026, 9, 12, 14, 5))).toBe('merge_2026-10-12_1405')
  })
  it('sanitizes typed tags', () => {
    expect(sanitizeTag('  my  tag ')).toBe('my_tag')
    expect(sanitizeTag('')).toBe('')
  })
})

describe('applyRenames', () => {
  it('rewrites img and sound references only', () => {
    const out = applyRenames({ f: '<img src="a.jpg"> a.jpg [sound:a.jpg]' }, { 'a.jpg': 'a-1.jpg' })
    expect(out.f).toBe('<img src="a-1.jpg"> a.jpg [sound:a-1.jpg]')
    const spaced = applyRenames({ f: '<img src="my pic.jpg">' }, { 'my pic.jpg': 'my pic-1.jpg' })
    expect(spaced.f).toBe('<img src="my pic-1.jpg">')
  })
})

describe('executePlan', () => {
  const fakeClient = (overrides = {}) => ({
    backup: vi.fn().mockResolvedValue({ ok: true, file: '/b.colpkg' }),
    call: vi.fn().mockResolvedValue(null),
    multi: vi.fn(async (actions) =>
      actions.map((a) => (a.action === 'storeMediaFile' ? { result: a.params.filename.replace('a.jpg', 'a-1.jpg') } : { result: 1 })),
    ),
    ...overrides,
  })
  const readMedia = async (names) => Object.fromEntries(names.map((n) => [n, 'AAAA']))

  it('writes nothing when the backup fails', async () => {
    const client = fakeClient({ backup: vi.fn().mockRejectedValue('bridge down') })
    await expect(executePlan(client, plan(), { readMedia })).rejects.toThrow(/Backup failed/)
    expect(client.call).not.toHaveBeenCalled()
    expect(client.multi).not.toHaveBeenCalled()
  })

  it('backs up first, then deck, model, media, notes, updates, tags', async () => {
    const client = fakeClient()
    const report = await executePlan(client, plan(), { readMedia })

    expect(client.backup.mock.invocationCallOrder[0]).toBeLessThan(client.call.mock.invocationCallOrder[0])
    expect(client.call.mock.calls.map((c) => [c[0], c[1].deck ?? c[1].modelName])).toEqual([
      ['createDeck', 'Imported'],
      ['createModel', 'Vocab'],
    ])
    expect(client.multi.mock.calls.map((c) => c[0][0].action)).toEqual([
      'storeMediaFile',
      'addNote',
      'updateNoteFields',
      'addTags',
    ])
    // The renamed media file is rewritten in the added note.
    const added = client.multi.mock.calls[1][0][0].params.note
    expect(added.fields.Front).toBe('<img src="a-1.jpg">')
    expect(report).toMatchObject({ added: { ok: 1 }, updated: { ok: 2 }, tagged: { ok: 1 } })
    expect(report.media.renamed).toEqual({ 'a.jpg': 'a-1.jpg' })
  })

  it('creates every deck the plan needs', async () => {
    const client = fakeClient()
    const p = { ...plan(), decks: ['A', 'B::C'], newNotes: [] }
    await executePlan(client, p, { readMedia })
    expect(client.call.mock.calls.filter((c) => c[0] === 'createDeck').map((c) => c[1].deck)).toEqual(['A', 'B::C'])
  })

  it('refuses a plan with collisions before backing up', async () => {
    const client = fakeClient()
    const bad = { ...plan(), collisions: [{ id: 1, field: 'Front', values: [] }] }
    await expect(executePlan(client, bad, { readMedia })).rejects.toThrow(/disagree/)
    expect(client.backup).not.toHaveBeenCalled()
  })

  it('collects per-note failures without aborting', async () => {
    const client = fakeClient({
      multi: vi.fn(async (actions) =>
        actions.map((a) => (a.action === 'addNote' ? { error: 'duplicate' } : { result: a.params.filename ?? 1 })),
      ),
    })
    const report = await executePlan(client, plan(), { readMedia })
    expect(report.added.failed).toEqual([{ guid: 'n1', error: 'duplicate' }])
    expect(report.updated.ok).toBe(2)
  })
})
