import { describe, expect, it } from 'vitest'
import { analyze, compareFields, initialResolution, matchKey, mediaReferences } from './match.js'

const notetype = { id: 1, name: 'Tibetan Vocab', fields: ['Tibetan', 'English', 'Notes'], templates: [] }

const pkgNote = (guid, fields, tags = []) => ({ id: guid.length, guid, notetypeId: 1, fields, tags })

const libNote = (id, fields, tags = []) => ({
  id,
  modelName: 'Tibetan Vocab',
  fieldOrder: ['Tibetan', 'English', 'Notes'],
  fields: { Tibetan: fields[0], English: fields[1], Notes: fields[2] },
  tags,
})

const run = (notes, libNotes, guidMap = {}, mapping = { 1: { modelName: 'Tibetan Vocab', create: false } }) =>
  analyze({
    pkg: { notetypes: [notetype], notes, media: [] },
    guidMap,
    libNotes,
    mapping,
    settings: { mainField: 'tibetan', autoFillEmpty: true },
  })

describe('matchKey', () => {
  it('ignores markup, case, nbsp and whitespace', () => {
    expect(matchKey('<b>Hello</b>&nbsp; World ')).toBe('hello world')
  })
})

describe('analyze', () => {
  it('prefers a GUID match over the main field', () => {
    const [r] = run([pkgNote('g1', ['ཀ', 'ka', ''])], [libNote(10, ['ཁ', 'ka', '']), libNote(11, ['ཀ', 'ka', ''])], { g1: 10 })
    expect(r.matchedBy).toBe('guid')
    expect(r.libNote.id).toBe(10)
    expect(r.kind).toBe('conflict') // Tibetan differs: ཀ vs ཁ
  })

  it('falls back to the main field, case- and markup-insensitively', () => {
    const [r] = run([pkgNote('g1', ['<b>ཀ</b>', 'ka', ''])], [libNote(11, ['ཀ ', 'ka', ''])])
    expect(r.matchedBy).toBe('field')
    expect(r.kind).toBe('conflict') // markup differs in the field itself
  })

  it('classifies new, identical, auto and conflict', () => {
    const results = run(
      [
        pkgNote('new', ['ག', 'ga', '']),
        pkgNote('same', ['ཀ', 'ka', '']),
        pkgNote('fill', ['ཁ', 'kha', 'aspirated']),
        pkgNote('tag', ['ང', 'nga', ''], ['letters']),
        pkgNote('diff', ['ཅ', 'cha', '']),
      ],
      [
        libNote(1, ['ཀ', 'ka', '']),
        libNote(2, ['ཁ', 'kha', '']),
        libNote(3, ['ང', 'nga', ''], ['Letters', 'x']),
        libNote(4, ['ཅ', 'ca', '']),
      ],
    )
    expect(results.map((r) => r.kind)).toEqual(['new', 'identical', 'auto', 'identical', 'conflict'])
    expect(results[3].tagsToAdd).toEqual([]) // tag comparison is case-insensitive
  })

  it('never lets an empty package field overwrite library content', () => {
    const [r] = run([pkgNote('g', ['ཀ', '', ''])], [libNote(1, ['ཀ', 'ka', 'note'])])
    expect(r.kind).toBe('identical')
  })

  it('flags ambiguous main-field matches', () => {
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [libNote(1, ['ཀ', 'ka', '']), libNote(2, ['ཀ', 'ka', ''])])
    expect(r.ambiguous).toBe(true)
  })

  it('only matches by GUID when the notetype is being created', () => {
    const mapping = { 1: { modelName: 'Tibetan Vocab', create: true } }
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [libNote(1, ['ཀ', 'ka', ''])], {}, mapping)
    expect(r.kind).toBe('new')
  })
})

describe('compareFields', () => {
  it('treats an empty library field as a conflict when auto-fill is off', () => {
    const { fields } = compareFields({ Tibetan: 'ཀ', English: 'ka', Notes: 'x' }, libNote(1, ['ཀ', 'ka', '']), {
      autoFillEmpty: false,
    })
    expect(fields.find((f) => f.name === 'Notes').status).toBe('conflict')
  })

  it('reports package fields the library model lacks', () => {
    const { dropped } = compareFields({ Tibetan: 'ཀ', Audio: '[sound:ka.mp3]' }, libNote(1, ['ཀ', '', '']))
    expect(dropped).toEqual(['Audio'])
  })
})

describe('initialResolution', () => {
  it('starts from library values except fills', () => {
    const [r] = run([pkgNote('g', ['ཀ', 'kaa', 'new note'])], [libNote(1, ['ཀ', 'ka', ''])])
    expect(initialResolution(r).values).toEqual({ Tibetan: 'ཀ', English: 'ka', Notes: 'new note' })
  })
})

describe('mediaReferences', () => {
  it('finds images and sounds, skipping remote URLs', () => {
    const html = '<img src="a b.jpg"><img src=\'c.png\'>[sound:d.mp3]<img src="https://x/y.png">'
    expect(mediaReferences(html).sort()).toEqual(['a b.jpg', 'c.png', 'd.mp3'])
  })
})
