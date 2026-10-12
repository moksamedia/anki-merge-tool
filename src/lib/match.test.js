import { describe, expect, it } from 'vitest'
import { pairKey } from './fieldMap.js'
import { analyze, compareFields, initialResolution, libraryFingerprint, matchKey, mediaReferences, selectMatches, toRecord } from './match.js'

const notetype = { id: 1, name: 'Tibetan Vocab', fields: ['Tibetan', 'English', 'Notes'], templates: [] }

const pkgNote = (guid, fields, tags = []) => ({ id: guid.length, guid, notetypeId: 1, fields, tags })

const libNote = (id, fields, tags = [], modelName = 'Tibetan Vocab', fieldOrder = ['Tibetan', 'English', 'Notes']) => ({
  id,
  modelName,
  fieldOrder,
  fields: Object.fromEntries(fieldOrder.map((name, i) => [name, fields[i] ?? ''])),
  tags,
})

const DEFAULT_MAPPING = { 1: { modelName: 'Tibetan Vocab', create: false } }

// Mirrors runAnalysis: phase 1 on lightweight records, phase 2 on full notes.
function run(notes, libNotes, guidMap = {}, mapping = DEFAULT_MAPPING, extra = {}, notetypes = [notetype], phase2 = {}) {
  const settings = { mainField: 'tibetan', autoFillEmpty: true, ...extra }
  const pkg = { notetypes, notes, media: [] }
  const records = libNotes.map((n) => toRecord(n, settings.mainField))
  const matches = selectMatches({ pkg, guidMap, records, mapping, settings })
  return analyze({ pkg, matches, libNotes, mapping, settings, ...phase2 })
}

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
    const [r] = run(notes, libs, { g1: 10 }, DEFAULT_MAPPING, { ignoreGuid: true })
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

  it('matches across note types (library-wide)', () => {
    const other = libNote(7, ['ཀ', 'ka (other)'], [], 'Tibetan Sentences', ['Tibetan', 'Gloss'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [other])
    expect(r.matchedBy).toBe('field')
    expect(r.libNote.modelName).toBe('Tibetan Sentences')
    expect(r.dropped).toEqual(['English']) // package fields the other type lacks
  })

  it('matches library notes even when the package note type is being created', () => {
    const mapping = { 1: { modelName: 'Tibetan Vocab', create: true } }
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [libNote(1, ['ཀ', 'ka', ''])], {}, mapping)
    expect(r.matchedBy).toBe('field')
  })

  it('prefers a candidate in the mapped note type', () => {
    const other = libNote(7, ['ཀ', ''], [], 'Other', ['Tibetan', 'Gloss'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [other, libNote(8, ['ཀ', 'ka', ''])])
    expect(r.libNote.id).toBe(8)
    expect(r.ambiguous).toBe(true)
  })

  it('ignores library note types without the main field', () => {
    const basic = libNote(9, ['ཀ', 'ka'], [], 'Basic', ['Front', 'Back'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [basic])
    expect(r.kind).toBe('new')
  })

  it('falls back to the first field, within the mapped note type only, when the package type lacks the main field', () => {
    const pkgBasic = { id: 2, name: 'Basic', fields: ['Front', 'Back'], templates: [] }
    const note = { id: 1, guid: 'b', notetypeId: 2, fields: ['ཀ', 'ka'], tags: [] }
    const mapping = { 2: { modelName: 'Basic', create: false } }
    const basic = libNote(9, ['ཀ', 'ka'], [], 'Basic', ['Front', 'Back'])
    const otherFirst = libNote(10, ['ཀ', 'x'], [], 'Reverse', ['Front', 'Back'])
    const [r] = run([note], [otherFirst, basic], {}, mapping, {}, [pkgBasic])
    expect(r.libNote.id).toBe(9)
    expect(r.ambiguous).toBe(false)
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

describe('field names', () => {
  it('matches package and library field names case-insensitively', () => {
    const lib = libNote(1, ['ཀ', 'ka', ''], [], 'Tibetan Vocab', ['tibetan', 'ENGLISH', 'Notes'])
    const [r] = run([pkgNote('g', ['ཀ', 'kaa', 'n'])], [lib])
    expect(r.kind).toBe('conflict')
    expect(r.fields.map((f) => [f.name, f.status])).toEqual([
      ['tibetan', 'same'],
      ['ENGLISH', 'conflict'],
      ['Notes', 'fill'],
    ])
    expect(r.dropped).toEqual([])
  })
})

describe('field maps', () => {
  const sentences = (fields) => libNote(7, fields, [], 'Tibetan Sentences', ['Tibetan', 'Gloss', 'Extra'])
  const glossFromEnglish = { [pairKey(1, 'Tibetan Sentences')]: { Tibetan: 'Tibetan', Gloss: 'English', Extra: 'Notes' } }

  it('compares a cross-type match through the chosen map', () => {
    const [r] = run([pkgNote('g', ['ཀ', 'ka', 'n'])], [sentences(['ཀ', 'kaa', ''])], {}, DEFAULT_MAPPING, {}, [notetype], {
      fieldMaps: glossFromEnglish,
    })
    expect(r.fields.map((f) => [f.name, f.pkgName, f.status])).toEqual([
      ['Tibetan', 'Tibetan', 'same'],
      ['Gloss', 'English', 'conflict'],
      ['Extra', 'Notes', 'fill'],
    ])
    expect(r.dropped).toEqual([])
  })

  it('gives new notes for an existing model the map for that pair', () => {
    const mapping = { 1: { modelName: 'Words', create: false } }
    const fieldMaps = { [pairKey(1, 'Words')]: { Word: 'Tibetan', Meaning: 'English' } }
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [], {}, mapping, {}, [notetype], { fieldMaps })
    expect(r.kind).toBe('new')
    expect(r.fieldMap).toEqual({ Word: 'Tibetan', Meaning: 'English' })
  })

  it('invalidates a decision when a field is remapped', () => {
    const notes = [pkgNote('g', ['ཀ', 'ka', 'n'])]
    const lib = [sentences(['ཀ', 'kaa', ''])]
    const [byName] = run(notes, lib)
    const [mapped] = run(notes, lib, {}, DEFAULT_MAPPING, {}, [notetype], { fieldMaps: glossFromEnglish })
    expect(libraryFingerprint(byName)).not.toBe(libraryFingerprint(mapped))
  })
})

describe('libraryFingerprint', () => {
  it('changes when the library note is edited or a different note matches', () => {
    const pkg = [pkgNote('g', ['ཀ', 'kaa', ''])]
    const [a] = run(pkg, [libNote(1, ['ཀ', 'ka', ''])])
    const [edited] = run(pkg, [libNote(1, ['ཀ', 'ka', 'now has a note'])])
    const [other] = run(pkg, [libNote(2, ['ཀ', 'ka', ''])])
    expect(libraryFingerprint(a)).toBe(libraryFingerprint(run(pkg, [libNote(1, ['ཀ', 'ka', ''])])[0]))
    expect(libraryFingerprint(a)).not.toBe(libraryFingerprint(edited))
    expect(libraryFingerprint(a)).not.toBe(libraryFingerprint(other))
    expect(initialResolution(a).lib).toBe(libraryFingerprint(a))
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
