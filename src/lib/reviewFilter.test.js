import { describe, expect, it } from 'vitest'
import { allTags, emptyFilter, entryMatches, hasAnyTag, isFiltering, searchFields } from './reviewFilter.js'

const vocab = { id: 1, name: 'Tibetan Vocab', fields: ['Tibetan', 'English'] }
const phrase = { id: 2, name: 'Tibetan Phrase', fields: ['Tibetan', 'English', 'Image Source'] }

const entry = (notetype, pkgFields, tags = [], libNote = null) => ({ notetype, pkgFields, pkgNote: { tags }, libNote })
const withLib = (fields) => ({ fieldOrder: Object.keys(fields), fields })

const a = entry(vocab, { Tibetan: 'དཔྲལ་བ་', English: '<b>Forehead</b>' }, ['Basics::Body'], withLib({ Tibetan: 'དཔྲལ་བ་', Gloss: 'brow' }))
const b = entry(phrase, { Tibetan: 'དུས་ཡུན་རིང་པོ།', English: 'A long time', 'Image Source': 'https://x.org/y' }, ['Phrases'])

const filter = (over) => ({ ...emptyFilter(), ...over })

describe('entryMatches', () => {
  it('passes everything with an empty filter', () => {
    expect([a, b].every((e) => entryMatches(e, emptyFilter()))).toBe(true)
    expect(isFiltering(emptyFilter())).toBe(false)
  })

  it('filters by package note type', () => {
    expect([a, b].filter((e) => entryMatches(e, filter({ notetype: '2' })))).toEqual([b])
  })

  it('searches text without markup or case, in package and library fields', () => {
    expect(entryMatches(a, filter({ text: 'forehead' }))).toBe(true)
    expect(entryMatches(a, filter({ text: 'BROW' }))).toBe(true)
    expect(entryMatches(b, filter({ text: 'forehead' }))).toBe(false)
  })

  it('finds Tibetan regardless of how a stack is encoded', () => {
    const c = entry(vocab, { Tibetan: 'གྷ', English: '' })
    expect(entryMatches(c, filter({ text: 'གྷ' }))).toBe(true)
  })

  it('limits the search to the chosen fields', () => {
    expect(entryMatches(a, filter({ text: 'brow', fields: ['English'] }))).toBe(false)
    expect(entryMatches(a, filter({ text: 'brow', fields: ['Gloss'] }))).toBe(true)
  })
})

describe('hasAnyTag', () => {
  it('matches any wanted tag, case-insensitively, including its children', () => {
    expect(hasAnyTag(['Basics::Body'], ['basics'])).toBe(true)
    expect(hasAnyTag(['Basics::Body'], ['Phrases', 'Basics::Body'])).toBe(true)
    expect(hasAnyTag(['BasicsExtra'], ['Basics'])).toBe(false)
    expect(hasAnyTag([], [])).toBe(true)
  })
})

describe('searchFields / allTags', () => {
  it('lists field names once, with the sides that have them', () => {
    expect(searchFields([a, b])).toEqual([
      { name: 'Tibetan', pkg: true, lib: true },
      { name: 'English', pkg: true, lib: false },
      { name: 'Gloss', pkg: false, lib: true },
      { name: 'Image Source', pkg: true, lib: false },
    ])
  })

  it('lists package tags sorted', () => {
    expect(allTags([b, a])).toEqual(['Basics::Body', 'Phrases'])
  })
})
