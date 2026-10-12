import { describe, expect, it, vi } from 'vitest'
import { applyRenames, buildPlan, executePlan } from './applyMerge.js'

const notetype = {
  id: 1,
  name: 'Vocab',
  isCloze: false,
  css: '@font-face { src: url("_tibetan.ttf") }',
  fields: ['Front', 'Back'],
  templates: [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{Back}}' }],
}

const pkg = { notetypes: [notetype], media: ['a.jpg', '_tibetan.ttf', 'unused.png'] }

const entries = [
  {
    kind: 'new',
    guid: 'n1',
    notetype,
    target: { modelName: 'Vocab', create: true },
    pkgFields: { Front: '<img src="a.jpg">', Back: 'b' },
    pkgNote: { tags: ['t'] },
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
  buildPlan({ pkg, entries, resolutions, excluded: new Set(), libModelFields: {}, targetDeck: 'Imported' })

describe('buildPlan', () => {
  it('collects only accepted conflicts and changed fields', () => {
    const p = plan()
    expect(p.newNotes).toHaveLength(1)
    expect(p.updates).toEqual([
      { guid: 'a1', id: 100, fields: { Back: 'filled' } },
      { guid: 'c1', id: 200, fields: { Front: 'merged' } },
    ])
    expect(p.tagAdds).toEqual([{ guid: 'a1', id: 100, tags: ['extra'] }])
  })

  it('creates models for new notes and copies only referenced media', () => {
    const p = plan()
    expect(p.modelsToCreate.map((m) => m.modelName)).toEqual(['Vocab'])
    expect(p.media.sort()).toEqual(['_tibetan.ttf', 'a.jpg'])
  })

  it('honours exclusions', () => {
    const p = buildPlan({ pkg, entries, resolutions, excluded: new Set(['n1', 'a1']), libModelFields: {}, targetDeck: 'D' })
    expect(p.newNotes).toHaveLength(0)
    expect(p.modelsToCreate).toHaveLength(0)
    expect(p.updates.map((u) => u.guid)).toEqual(['c1'])
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
    expect(client.call.mock.calls.map((c) => c[0])).toEqual(['createDeck', 'createModel'])
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
