import { describe, expect, it } from 'vitest'
import { buildPlan } from './applyMerge.js'
import { buildDryRun } from './dryRun.js'

const notetype = {
  id: 1,
  name: 'Vocab',
  isCloze: false,
  css: '',
  fields: ['Tibetan', 'English'],
  templates: [{ name: 'Card 1', qfmt: '{{Tibetan}}', afmt: '{{English}}' }],
}

const pkg = {
  format: 'anki21',
  notetypes: [notetype],
  media: ['a.jpg', 'unused.png'],
  notes: Array.from({ length: 7 }, (_, i) => ({ notetypeId: 1, deckId: 1, id: i })),
  decks: [
    { id: 1, name: 'Ocean::1 Basics' },
    { id: 2, name: 'Ocean::2 Patterns' },
  ],
}

const pkgFields = (tibetan, english) => ({ Tibetan: tibetan, English: english })
const matched = (guid, kind, id, fields, extra = {}) => ({
  kind,
  guid,
  notetype,
  pkgFields: pkgFields(fields[0].pkg, fields[1].pkg),
  pkgNote: { tags: [], deckId: 1 },
  libNote: { id, modelName: 'Vocab' },
  matchedBy: 'field',
  fields: [
    { name: 'Tibetan', ...fields[0] },
    { name: 'English', ...fields[1] },
  ],
  tagsToAdd: [],
  sharedWith: [],
  dropped: [],
  ...extra,
})

const entries = [
  {
    kind: 'new',
    guid: 'new1',
    notetype,
    target: { modelName: 'Vocab', create: true },
    pkgFields: pkgFields('ཀ', '<img src="a.jpg">'),
    pkgNote: { tags: ['t'], deckId: 2 },
  },
  {
    kind: 'new',
    guid: 'new2',
    notetype,
    target: { modelName: 'Vocab', create: true },
    pkgFields: pkgFields('ཁ', 'kha'),
    pkgNote: { tags: [], deckId: 1 },
  },
  matched('fill1', 'auto', 100, [
    { lib: 'ག', pkg: 'ག', status: 'same' },
    { lib: '', pkg: 'ga', status: 'fill' },
  ], { tagsToAdd: ['extra'] }),
  matched('acc1', 'conflict', 200, [
    { lib: 'ང', pkg: 'ང', status: 'same' },
    { lib: 'nga', pkg: 'ṅa', status: 'conflict' },
  ], { ambiguous: true }),
  matched('edit1', 'conflict', 300, [
    { lib: 'ཅ', pkg: 'ཅ', status: 'same' },
    { lib: 'ca', pkg: 'cha', status: 'conflict' },
  ]),
  matched('skip1', 'conflict', 400, [
    { lib: 'ཆ', pkg: 'ཆ', status: 'same' },
    { lib: 'cha', pkg: 'chha', status: 'conflict' },
  ]),
  matched('undecided1', 'conflict', 500, [
    { lib: 'ཇ', pkg: 'ཇ', status: 'same' },
    { lib: 'ja', pkg: 'jha', status: 'conflict' },
  ]),
  matched('same1', 'identical', 600, [
    { lib: 'ཉ', pkg: 'ཉ', status: 'same' },
    { lib: 'nya', pkg: 'nya', status: 'same' },
  ]),
  matched('excl1', 'auto', 700, [
    { lib: 'ཏ', pkg: 'ཏ', status: 'same' },
    { lib: '', pkg: 'ta', status: 'fill' },
  ]),
]

const resolutions = {
  acc1: { status: 'accepted', values: { Tibetan: 'ང', English: 'ṅa' } },
  edit1: { status: 'accepted', values: { Tibetan: 'ཅ', English: 'ca / cha' } },
  skip1: { status: 'skipped', values: { Tibetan: 'ཆ', English: 'cha' } },
  undecided1: { status: 'pending', values: { Tibetan: 'ཇ', English: 'ja' } },
}
// Merging is opt-in; 'excl1' (an auto-merge) is left unaccepted.
const accepted = new Set(['new1', 'new2', 'fill1'])

function report(overrides = {}, { excluded = new Set(), merged = {} } = {}) {
  const plan = buildPlan({
    pkg,
    entries,
    resolutions,
    excluded,
    accepted,
    deckMode: 'package',
    targetDeck: 'Fallback',
    mergeTag: 'merge_test',
    ...overrides,
  })
  return buildDryRun({
    pkg,
    pkgPath: '/tmp/Ocean.apkg',
    settings: { mainField: 'Tibetan', ignoreGuid: true, autoFillEmpty: true },
    entries,
    plan,
    resolutions,
    excluded,
    accepted,
    merged,
    libDecks: ['Ocean::1 Basics'],
    mapping: { 1: { modelName: 'Vocab', create: true } },
    generatedAt: '2026-10-12T00:00:00.000Z',
  })
}

describe('buildDryRun', () => {
  it('summarizes the analysis, decisions and writes', () => {
    const r = report()
    expect(r.summary.analysis).toEqual({ new: 2, identical: 1, auto: 2, conflict: 4 })
    expect(r.summary.conflicts).toEqual({ accepted: 2, skipped: 1, undecided: 1 })
    expect(r.summary.notAccepted).toEqual({ new: 0, auto: 1 })
    expect(r.summary).toMatchObject({ notesAdded: 2, notesUpdated: 3, fieldsChanged: 3, unchanged: 1 })
    expect(r.package).toEqual({ path: '/tmp/Ocean.apkg', file: 'Ocean.apkg', format: 'anki21', notes: 7, mediaFiles: 2 })
  })

  it('labels each change with why it happens', () => {
    const byId = Object.fromEntries(report().updates.map((u) => [u.libNoteId, u]))
    expect(byId[100].changes).toEqual([{ field: 'English', from: '', to: 'ga', reason: 'fill' }])
    expect(byId[200].changes).toEqual([{ field: 'English', from: 'nga', to: 'ṅa', reason: 'package' }])
    expect(byId[300].changes).toEqual([{ field: 'English', from: 'ca', to: 'ca / cha', reason: 'edited' }])
    expect(byId[100].tagsAdded).toEqual(['extra', 'merge_test'])
    expect(byId[200]).toMatchObject({ label: 'ང', noteType: 'Vocab', matchedBy: 'field', via: ['acc1'] })
  })

  it('lists notes left alone with the reason', () => {
    expect(report().skipped).toEqual([
      { guid: 'skip1', label: 'ཆ', kind: 'conflict', reason: 'skipped' },
      { guid: 'undecided1', label: 'ཇ', kind: 'conflict', reason: 'undecided' },
      { guid: 'excl1', label: 'ཏ', kind: 'auto', reason: 'not accepted' },
    ])
  })

  it('leaves every new note and auto-merge alone when nothing is accepted', () => {
    const none = new Set()
    const plan = buildPlan({ pkg, entries, resolutions, accepted: none, targetDeck: 'D' })
    const r = buildDryRun({
      pkg, pkgPath: '/tmp/Ocean.apkg', settings: { mainField: 'Tibetan' }, entries, plan, resolutions,
      accepted: none, libDecks: [], mapping: {}, generatedAt: 'now',
    })
    expect(r.summary.notAccepted).toEqual({ new: 2, auto: 2 })
    expect(r.summary).toMatchObject({ notesAdded: 0, notesUpdated: 2 }) // the two accepted conflicts only
    expect(r.newNotes).toEqual([])
    expect(r.skipped.filter((s) => s.reason === 'not accepted').map((s) => s.guid)).toEqual(['new1', 'new2', 'fill1', 'excl1'])
    // No warnings for notes this run doesn't write: acc1 is ambiguous but still written.
    expect(r.warnings.map((w) => w.guid)).toEqual(['acc1'])
  })

  it('reports already-merged notes as merged, even if accepted', () => {
    const r = report({}, { excluded: new Set(['fill1']), merged: { fill1: { run: 1 } } })
    expect(r.skipped).toContainEqual({ guid: 'fill1', label: 'ག', kind: 'auto', reason: 'merged' })
    expect(r.updates.map((u) => u.libNoteId)).not.toContain(100)
  })

  it('reports decks, including which will be created', () => {
    const r = report()
    expect(r.decks).toEqual({
      mode: 'package',
      target: null,
      used: [
        { name: 'Ocean::1 Basics', newNotes: 1, exists: true },
        { name: 'Ocean::2 Patterns', newNotes: 1, exists: false },
      ],
      create: ['Ocean::2 Patterns'],
    })
    expect(report({ deckMode: 'single' }).decks).toMatchObject({ mode: 'single', target: 'Fallback', create: ['Fallback'] })
  })

  it('reports new notes with deck, tags and full fields', () => {
    expect(report().newNotes[0]).toEqual({
      guid: 'new1',
      label: 'ཀ',
      deck: 'Ocean::2 Patterns',
      noteType: 'Vocab',
      tags: ['t', 'merge_test'],
      fields: { Tibetan: 'ཀ', English: '<img src="a.jpg">' },
    })
  })

  it('reports note types, media, merge tag and warnings', () => {
    const r = report()
    expect(r.noteTypes.create).toEqual([{ name: 'Vocab', fields: ['Tibetan', 'English'], templates: ['Card 1'], cloze: false }])
    expect(r.noteTypes.targets).toEqual([{ package: 'Vocab', library: 'Vocab', create: true, notes: 7 }])
    expect(r.media).toEqual(['a.jpg'])
    expect(r.mergeTag).toBe('merge_test')
    expect(r.warnings).toEqual([expect.objectContaining({ kind: 'ambiguous', guid: 'acc1' })])
  })

  it('lists steps in the order the merge runs them', () => {
    expect(report().steps).toEqual([
      'Create a full collection backup; stop without changing anything if it fails',
      'Ensure 2 decks exist (1 new)',
      'Create note type "Vocab"',
      'Copy 1 media file (differing library files are kept; ours are renamed)',
      'Add 2 new notes',
      'Update fields on 3 notes',
      'Add tags to 3 notes',
    ])
  })

  it('round-trips through JSON unchanged', () => {
    const r = report()
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
})
