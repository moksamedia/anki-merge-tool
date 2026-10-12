# Anki Merge Tool

Desktop app (Tauri 2 + Vue 3) that merges an `.apkg` package **directly into your live Anki library** — matching notes, letting you resolve conflicting fields side by side, and writing the result through AnkiConnect. Every merge starts with a full collection backup.

Successor to `../anki-merge-vue` (an Electron scaffold that never worked end to end).

## Requirements

Anki must be open with two add-ons:

- **AnkiConnect** (AnkiWeb code `2055492159`) on `127.0.0.1:8765`: reads and writes notes, media, decks and note types.
- **anki-ai-bridge** (`../anki-ai-bridge`) on `127.0.0.1:8766`, a version that has `POST /backup` and `POST /notes/by-guid`:
  - `/backup` creates the pre-merge `.colpkg` backup, which stock AnkiConnect can't do.
  - `/notes/by-guid` supports GUID matching; AnkiConnect's `notesInfo` doesn't return GUIDs.

No CORS setup is needed, because all HTTP calls go through the Rust side.

## Flow

1. **Connect:** checks both services.
2. **Package:** pick an `.apkg` file. All formats are supported: `anki21b` (zstd + protobuf media map), `anki21` and `anki2`.
3. **Configure:**
   - The main field (default `Tibetan`).
   - The target deck for new notes.
   - Which library note type each package note type maps to: an existing one (fields matched by name) or a newly created one.
4. **Analyze and review:**
   - Each package note is matched by GUID first, then by main field within the target note type.
   - **New:** the note is added to the target deck.
   - **Identical:** nothing to do.
   - **Auto:** only fills empty library fields and/or adds tags.
   - **Conflict:** opens the side-by-side merge, with Library | Package | Result per field, word diffs and a rendered preview. Pick a side per field, combine both, or edit the result. Keys: `A` accept, `S` skip, `J`/`K` move between notes, `R` toggle rendered.
   - Review decisions are saved per package file, so a long review can be resumed.
5. **Apply:**
   - Runs the backup first and stops if it fails.
   - Then creates the deck and note types, copies the media referenced by written notes, adds notes, updates fields and adds tags.
   - Media: a library file with the same name but different content is never overwritten. Anki stores ours under a new name and the note fields are rewritten to match.
   - Restore a backup with **File → Switch Profile → Open Backup** in Anki.

## Limitations

- New notes get fresh GUIDs, because AnkiConnect's `addNote` can't set them. Re-merging the same package later therefore matches those notes by main field, not GUID.
- Scheduling and review history aren't copied. Only content (fields, tags, media) is merged.
- AnkiConnect can't update a note that's open in Anki's Browse window, so close it before applying.

## Development

```sh
npm install
npm run tauri dev     # run the app
npm test              # vitest: matching, plan building, apply ordering
npm run test:rust     # cargo test: .apkg parser against fixtures
npm run lint
```

Layout:

- `src-tauri/src/apkg.rs`: the package parser.
- `src-tauri/src/anki.rs`: the AnkiConnect and bridge proxy.
- `src/lib/`: pure logic (`match.js`, `applyMerge.js`) and the client (`ankiClient.js`).
- `src/composables/useMergeSession.js`: session state.
- `src/components/`: the step views and `ConflictMerge.vue`.

Parser fixtures in `src-tauri/tests/fixtures/` are copied from `../anki-apkg-parser/test/decks/`.
