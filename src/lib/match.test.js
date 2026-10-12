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

  it('ignores trailing tsheg and shad', () => {
    const key = matchKey('བཀྲ་ཤིས')
    for (const v of ['བཀྲ་ཤིས་', 'བཀྲ་ཤིས།', 'བཀྲ་ཤིས་།', 'བཀྲ་ཤིས ། ', 'བཀྲ་ཤིས༎', 'བཀྲ་ཤིས༔']) {
      expect(matchKey(v)).toBe(key)
    }
  })

  it('keeps internal tshegs significant', () => {
    expect(matchKey('བཀྲ་ཤིས')).not.toBe(matchKey('བཀྲཤིས'))
  })

  it('treats the non-breaking tsheg as a tsheg', () => {
    expect(matchKey('ང\u0F0Cཀ')).toBe(matchKey('ང\u0F0Bཀ'))
  })

  it('matches precomposed and decomposed stacks', () => {
    expect(matchKey('\u0F43')).toBe(matchKey('\u0F42\u0FB7')) // གྷ
    expect(matchKey('\u0F73')).toBe(matchKey('\u0F71\u0F72')) // ཱི
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

  it('matches across tsheg/shad and Unicode spelling differences', () => {
    const [r] = run([pkgNote('g', ['\u0F42\u0FB7་', 'gha', ''])], [libNote(1, ['\u0F43', 'gha', ''])])
    expect(r.matchedBy).toBe('field')
    expect(r.libNote.id).toBe(1)
    // The stored Tibetan text still differs by a tsheg, so it is surfaced for review.
    expect(r.fields.find((f) => f.name === 'Tibetan').status).toBe('conflict')
  })

  it('does not report a composition-only difference as a conflict', () => {
    const [r] = run([pkgNote('g', ['\u0F42\u0FB7', 'gha', ''])], [libNote(1, ['\u0F43', 'gha', ''])])
    expect(r.kind).toBe('identical')
  })

  it('can ignore GUIDs and match on the main field only', () => {
    const notes = [pkgNote('g1', ['ཀ', 'ka', ''])]
    const libs = [libNote(10, ['ཁ', 'kha', '']), libNote(11, ['ཀ', 'ka', ''])]
    const [r] = analyze({
      pkg: { notetypes: [notetype], notes, media: [] },
      guidMap: { g1: 10 },
      libNotes: libs,
      mapping: { 1: { modelName: 'Tibetan Vocab', create: false } },
      settings: { mainField: 'Tibetan', autoFillEmpty: true, ignoreGuid: true },
    })
    expect(r.matchedBy).toBe('field')
    expect(r.libNote.id).toBe(11)
  })

  it('records package notes that share a library note', () => {
    const results = run(
      [pkgNote('a', ['ཀ', 'ka', '']), pkgNote('b', ['ཀ་', 'kaa', '']), pkgNote('c', ['ཁ', 'kha', ''])],
      [libNote(1, ['ཀ', 'ka', '']), libNote(2, ['ཁ', 'kha', ''])],
    )
    expect(results.map((r) => r.sharedWith)).toEqual([['b'], ['a'], []])
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
