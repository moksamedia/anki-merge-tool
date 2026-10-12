import { invoke } from '@tauri-apps/api/core'

const NOTES_INFO_CHUNK = 250

/** AnkiConnect's notesInfo returns fields as {name: {value, order}}; flatten to plain strings. */
export function normalizeNoteInfo(info) {
  const entries = Object.entries(info.fields).sort((a, b) => a[1].order - b[1].order)
  return {
    id: info.noteId,
    modelName: info.modelName,
    fieldOrder: entries.map(([name]) => name),
    fields: Object.fromEntries(entries.map(([name, f]) => [name, f.value])),
    tags: info.tags ?? [],
  }
}

/**
 * Client over the Rust proxy commands. `settings` is read on every call so URL
 * edits in the UI take effect without recreating the client.
 */
export function createAnkiClient(settings) {
  const call = (action, params = {}, timeoutSecs) =>
    invoke('anki_connect', { url: settings.ankiConnectUrl, action, params, timeoutSecs })

  const bridge = (method, path, body, timeoutSecs) =>
    invoke('bridge', { url: settings.bridgeUrl, method, path, body, timeoutSecs })

  /** Runs actions in one round trip; each item becomes {result} or {error}. */
  const multi = async (actions, timeoutSecs) => {
    const results = await call('multi', { actions }, timeoutSecs)
    return results.map((r) =>
      r && typeof r === 'object' && 'error' in r
        ? r.error ? { error: r.error } : { result: r.result }
        : { result: r },
    )
  }

  return {
    call,
    multi,
    version: () => call('version'),
    deckNames: () => call('deckNames'),
    modelNames: () => call('modelNames'),
    modelFieldNames: (modelName) => call('modelFieldNames', { modelName }),
    /** {field: {font, size}} per field of a note type. */
    modelFieldFonts: (modelName) => call('modelFieldFonts', { modelName }),

    async notesInfo(ids) {
      const out = []
      for (let i = 0; i < ids.length; i += NOTES_INFO_CHUNK) {
        const infos = await call('notesInfo', { notes: ids.slice(i, i + NOTES_INFO_CHUNK) })
        // Deleted ids come back as empty objects.
        out.push(...infos.filter((n) => n.noteId).map(normalizeNoteInfo))
      }
      return out
    },

    retrieveMediaFile: (filename) => call('retrieveMediaFile', { filename }),

    bridgeHealth: () => bridge('GET', '/health', null, 5),
    // Allow the bridge its full backup window plus some slack.
    backup: () => bridge('POST', '/backup', null, 240),
    notesByGuid: (guids) => bridge('POST', '/notes/by-guid', { guids }, 60),
    /** Every library note as {id, modelName, main, first}; main is null if its type lacks `field`. */
    async fieldValues(field) {
      const rows = await bridge('POST', '/notes/field-values', { field }, 120)
      return rows.map(([id, modelName, main, first]) => ({ id, modelName, main, first }))
    },
  }
}
