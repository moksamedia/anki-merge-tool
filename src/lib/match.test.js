import { describe, expect, it } from 'vitest'
import { pairKey } from './fieldMap.js'
import { analyze, compareFields, crossTypeMatch, initialResolution, libraryFingerprint, matchKey, mediaReferences, rankCandidates, selectMatches, toRecord } from './match.js'

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

// Mirrors runAnalysis: phase 1 on lightweight records, ranking and phase 2 on full notes.
function run(notes, libNotes, guidMap = {}, mapping = DEFAULT_MAPPING, extra = {}, notetypes = [notetype], phase2 = {}, picks = {}) {
  const settings = { mainField: 'tibetan', autoFillEmpty: true, ...extra }
  const pkg = { notetypes, notes, media: [] }
  const records = libNotes.map((n) => toRecord(n, settings.mainField))
  const selected = selectMatches({ pkg, guidMap, records, mapping, settings })
  const matches = rankCandidates({ pkg, matches: selected, libNotes, fieldMaps: phase2.fieldMaps, picks })
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

  it('prefers a filled library note over an empty stub with the same main field', () => {
    const stub = libNote(1, ['རྗེན་པ་', '', ''])
    const full = libNote(2, ['རྗེན་པ་', 'raw, uncooked', 'note'])
    const [r] = run([pkgNote('g', ['རྗེན་པ་', 'Raw', ''])], [stub, full])
    expect(r.libNote.id).toBe(2)
    expect(r.candidates.map((c) => c.id)).toEqual([2, 1])
    expect(r.candidates[0]).toMatchObject({ same: 1, filled: 3 })
  })

  it('prefers the candidate with the most fields in common', () => {
    const a = libNote(1, ['ཀ', 'other', 'long note here'])
    const b = libNote(2, ['ཀ', 'ka', ''])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', 'x'])], [a, b])
    expect(r.libNote.id).toBe(2)
  })

  it('matches only the declared note type, even when another type has a fuller note', () => {
    const other = libNote(7, ['ཀ', 'x', 'y'], [], 'Debate', ['Tibetan', 'English', 'Notes'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [libNote(8, ['ཀ', '', '']), other])
    expect(r.libNote.id).toBe(8)
    expect(r.ambiguous).toBe(false)
  })

  it('sends an ambiguous match that would write to conflicts', () => {
    const [r] = run([pkgNote('g', ['ཀ', 'ka', 'new note'])], [libNote(1, ['ཀ', 'ka', '']), libNote(2, ['ཀ', '', ''])])
    expect(r.libNote.id).toBe(1)
    expect(r.fields.every((f) => f.status !== 'conflict')).toBe(true)
    expect(r.kind).toBe('conflict')
  })

  it('uses the candidate the user picked, while it is still a candidate', () => {
    const libs = [libNote(1, ['ཀ', 'ka', '']), libNote(2, ['ཀ', '', ''])]
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], libs, {}, DEFAULT_MAPPING, {}, [notetype], {}, { g: 2 })
    expect(r.libNote.id).toBe(2)
    expect(r.picked).toBe(true)
    const [stale] = run([pkgNote('g', ['ཀ', 'ka', ''])], libs, {}, DEFAULT_MAPPING, {}, [notetype], {}, { g: 99 })
    expect(stale.libNote.id).toBe(1)
    expect(stale.picked).toBe(false)
  })

  it('drops candidates that left the library between phases', () => {
    const pkg = { notetypes: [notetype], notes: [pkgNote('g', ['ཀ', 'ka', ''])], media: [] }
    const settings = { mainField: 'tibetan', autoFillEmpty: true }
    const both = [libNote(1, ['ཀ', '', '']), libNote(2, ['ཀ', 'ka', ''])]
    const selected = selectMatches({ pkg, guidMap: {}, records: both.map((n) => toRecord(n, 'tibetan')), mapping: DEFAULT_MAPPING, settings })
    const libNotes = [both[0]] // note 2 was deleted
    const matches = rankCandidates({ pkg, matches: selected, libNotes })
    const [r] = analyze({ pkg, matches, libNotes, mapping: DEFAULT_MAPPING, settings })
    expect(r.libNote.id).toBe(1)
    expect(r.ambiguous).toBe(false)
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

  it('reports a main-field match in another note type as a possible duplicate', () => {
    const other = libNote(7, ['ཀ', 'ka (other)'], [], 'Tibetan Sentences', ['Tibetan', 'Gloss'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [other])
    expect(r.kind).toBe('new')
    expect(r.elsewhere).toEqual([{ id: 7, modelName: 'Tibetan Sentences' }])
  })

  it('reports a GUID match in another note type as a possible duplicate', () => {
    const other = libNote(7, ['ཁ', 'kha'], [], 'Tibetan Sentences', ['Tibetan', 'Gloss'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [other], { g: 7 })
    expect(r.kind).toBe('new')
    expect(r.elsewhere.map((e) => e.id)).toEqual([7])
  })

  it('treats every match as elsewhere when the package type is created as a new type', () => {
    const mapping = { 1: { modelName: 'Tibetan Vocab', create: true } }
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [libNote(1, ['ཀ', 'ka', ''])], {}, mapping)
    expect(r.kind).toBe('new')
    expect(r.elsewhere.map((e) => e.id)).toEqual([1])
  })

  it('ignores other types once the declared type has a match', () => {
    const other = libNote(7, ['ཀ', ''], [], 'Other', ['Tibetan', 'Gloss'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [other, libNote(8, ['ཀ', 'ka', ''])])
    expect(r.libNote.id).toBe(8)
    expect(r.ambiguous).toBe(false)
    expect(r.elsewhere).toBeUndefined()
  })

  it('merges into a note of another type when the user picks it', () => {
    const other = libNote(7, ['ཀ', 'ka (other)', ''], [], 'Tibetan Sentences', ['Tibetan', 'Gloss', 'Notes'])
    const [r] = run([pkgNote('g', ['ཀ', 'ka', 'n'])], [other], {}, DEFAULT_MAPPING, {}, [notetype], {}, { g: 7 })
    expect(r.libNote.id).toBe(7)
    expect(r.crossType).toBe(true)
    expect(r.matchedBy).toBe('chosen')
    expect(r.kind).toBe('auto') // fills Notes; English has no Gloss to go to by name
  })

  it('ignores a pick that is neither a candidate nor elsewhere', () => {
    const [r] = run([pkgNote('g', ['ཀ', 'ka', ''])], [], {}, DEFAULT_MAPPING, {}, [notetype], {}, { g: 99 })
    expect(r.kind).toBe('new')
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

describe('crossTypeMatch', () => {
  it('points a note with only elsewhere hits at the chosen note', () => {
    const m = { libId: null, matchedBy: null, candidates: [], elsewhere: [7, 8] }
    expect(crossTypeMatch(m, 8)).toMatchObject({ libId: 8, candidates: [8], crossType: true, elsewhere: [7, 8] })
  })
})

describe('field maps', () => {
  const SENTENCES = { 1: { modelName: 'Tibetan Sentences', create: false } }
  const sentences = (fields) => libNote(7, fields, [], 'Tibetan Sentences', ['Tibetan', 'Gloss', 'Extra'])
  const glossFromEnglish = { [pairKey(1, 'Tibetan Sentences')]: { Tibetan: 'Tibetan', Gloss: 'English', Extra: 'Notes' } }

  it('compares a cross-type match through the chosen map', () => {
    const [r] = run([pkgNote('g', ['ཀ', 'ka', 'n'])], [sentences(['ཀ', 'kaa', ''])], {}, SENTENCES, {}, [notetype], {
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
    const [byName] = run(notes, lib, {}, SENTENCES)
    const [mapped] = run(notes, lib, {}, SENTENCES, {}, [notetype], { fieldMaps: glossFromEnglish })
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

  it('finds [_sound:] references, the no-autoplay tag', () => {
    expect(mediaReferences('[_sound:riklam_32-07.mp3] [sound:b.mp3]').sort()).toEqual(['b.mp3', 'riklam_32-07.mp3'])
  })

  it('counts a field holding only a [_sound:] reference as content', () => {
    const { fields } = compareFields({ Tibetan: 'ཀ', English: '', Notes: '[_sound:n.mp3]' }, libNote(1, ['ཀ', '', '']))
    expect(fields.find((f) => f.name === 'Notes').status).toBe('fill')
  })
})
