import { describe, expect, it } from 'vitest'
import { defaultFieldMap, mapFields, needsFieldMap, reconcileFieldMap, unmappedFields, withNewFields } from './fieldMap.js'

describe('defaultFieldMap', () => {
  it('pairs fields by name, exact first, then case-insensitively', () => {
    expect(defaultFieldMap(['Tibetan', 'english', 'Audio'], ['Tibetan', 'English', 'Notes'])).toEqual({
      Tibetan: 'Tibetan',
      English: 'english',
      Notes: '',
    })
  })
})

describe('reconcileFieldMap', () => {
  it('keeps valid saved choices, including explicit "nothing"', () => {
    const saved = { Word: 'Tibetan', Meaning: '' }
    expect(reconcileFieldMap(saved, ['Tibetan', 'Meaning'], ['Word', 'Meaning'])).toEqual({ Word: 'Tibetan', Meaning: '' })
  })

  it('falls back to the same-name default for stale or missing entries', () => {
    const saved = { Word: 'Gone' }
    expect(reconcileFieldMap(saved, ['Word', 'Meaning'], ['Word', 'Meaning'])).toEqual({ Word: 'Word', Meaning: 'Meaning' })
  })
})

describe('mapFields', () => {
  it('renames package values onto library fields and can copy one source twice', () => {
    const map = { Word: 'Tibetan', Reading: 'Tibetan', Meaning: 'English', Notes: '' }
    expect(mapFields({ Tibetan: 'ཀ', English: 'ka', Audio: 'x' }, map)).toEqual({ Word: 'ཀ', Reading: 'ཀ', Meaning: 'ka' })
  })
})

describe('unmappedFields', () => {
  it('lists package fields no library field takes', () => {
    expect(unmappedFields(['Tibetan', 'English', 'Audio'], { Word: 'Tibetan', Meaning: 'English' })).toEqual(['Audio'])
  })
})

describe('needsFieldMap', () => {
  const nt = { name: 'Vocab', fields: ['Front', 'Back'] }
  it('is false for the same note type with the same fields', () => {
    expect(needsFieldMap(nt, 'Vocab', ['front', 'Back'])).toBe(false)
  })
  it('is true when the note types differ by name or fields', () => {
    expect(needsFieldMap(nt, 'Words', ['Front', 'Back'])).toBe(true)
    expect(needsFieldMap(nt, 'Vocab', ['Front', 'Back', 'Notes'])).toBe(true)
    expect(needsFieldMap(nt, 'Vocab', ['Front'])).toBe(true)
  })
})

describe('withNewFields', () => {
  it('appends scheduled fields, empty, to notes of that model only', () => {
    const a = { id: 1, modelName: 'Vocab', fieldOrder: ['Front'], fields: { Front: 'x' } }
    const b = { id: 2, modelName: 'Other', fieldOrder: ['Front'], fields: { Front: 'y' } }
    const [na, nb] = withNewFields([a, b], { Vocab: ['Audio', 'Front'] })
    expect(na.fieldOrder).toEqual(['Front', 'Audio'])
    expect(na.fields).toEqual({ Front: 'x', Audio: '' })
    expect(nb).toBe(b)
  })
})
