import { describe, expect, it } from 'vitest'
import { isManualEdit, takenSides, valueForSides } from './resultSides.js'

const f = { lib: 'ཞྭ་མོ', pkg: 'ཞྭ' }

describe('takenSides', () => {
  it('reads one side, both, or neither from the value', () => {
    expect(takenSides(f, 'ཞྭ་མོ')).toEqual({ lib: true, pkg: false })
    expect(takenSides(f, 'ཞྭ')).toEqual({ lib: false, pkg: true })
    expect(takenSides(f, 'ཞྭ་མོ<br>ཞྭ')).toEqual({ lib: true, pkg: true })
    expect(takenSides(f, '')).toEqual({ lib: false, pkg: false })
    expect(takenSides(f, 'typed')).toEqual({ lib: false, pkg: false })
  })

  it('never marks an empty side as taken', () => {
    expect(takenSides({ lib: '', pkg: 'x' }, 'x')).toEqual({ lib: false, pkg: true })
  })
})

describe('valueForSides', () => {
  it('round-trips with takenSides', () => {
    for (const sides of [{ lib: true, pkg: false }, { lib: false, pkg: true }, { lib: true, pkg: true }, { lib: false, pkg: false }]) {
      expect(takenSides(f, valueForSides(f, sides))).toEqual(sides)
    }
  })
})

describe('isManualEdit', () => {
  it('is true only for values the checkboxes cannot produce', () => {
    expect(isManualEdit(f, 'ཞྭ་མོ')).toBe(false)
    expect(isManualEdit(f, 'ཞྭ་མོ<br>ཞྭ')).toBe(false)
    expect(isManualEdit(f, '')).toBe(false)
    expect(isManualEdit(f, 'ཞྭ་མོ (hat)')).toBe(true)
  })
})
