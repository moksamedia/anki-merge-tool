// Which sides (library, package) a conflict's result takes. The result value is
// the only state: the Library/Package checkboxes are derived from it, and
// toggling one writes the value for the new combination.

/** Both values, library first, on separate lines; or whichever one exists. */
export const combineValues = (lib, pkg) => (lib && pkg ? `${lib}<br>${pkg}` : lib || pkg || '')

/** The result for a combination of sides; neither side gives an empty field. */
export function valueForSides(field, { lib, pkg }) {
  if (lib && pkg) return combineValues(field.lib, field.pkg)
  return lib ? field.lib : pkg ? field.pkg : ''
}

/**
 * Which sides `value` takes. Only a side with content can be taken; an empty
 * side would otherwise look "taken" whenever the other side is.
 */
export function takenSides(field, value) {
  const both = field.lib && field.pkg && field.lib !== field.pkg && value === combineValues(field.lib, field.pkg)
  return {
    lib: !!field.lib && (both || value === field.lib),
    pkg: !!field.pkg && (both || value === field.pkg),
  }
}

/** Whether `value` was typed by hand: not something the checkboxes produce. */
export function isManualEdit(field, value) {
  const v = value ?? ''
  return v !== '' && v !== field.lib && v !== field.pkg && v !== combineValues(field.lib, field.pkg)
}
