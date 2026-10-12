# Anki Merge Tool

Desktop app (Tauri 2 + Vue 3) that merges an `.apkg` package **directly into your live Anki library** — matching notes, letting you resolve conflicting fields side by side, and writing the result through AnkiConnect. Every merge starts with a full collection backup.

Successor to `../anki-merge-vue` (an Electron scaffold that never worked end to end).

## Requirements

Anki must be open with two add-ons:

- **AnkiConnect** (AnkiWeb code `2055492159`) on `127.0.0.1:8765`: reads and writes notes, media, decks and note types.
- **anki-ai-bridge** (`../anki-ai-bridge`) on `127.0.0.1:8766`, a version that has `POST /backup`, `POST /notes/by-guid` and `POST /notes/field-values`:
  - `/backup` creates the pre-merge `.colpkg` backup, which stock AnkiConnect can't do.
  - `/notes/by-guid` supports GUID matching; AnkiConnect's `notesInfo` doesn't return GUIDs.
  - `/notes/field-values` reads the main field of every note in one pass for library-wide matching. AnkiConnect `findNotes` isn't used: on Anki 26.8+ AnkiConnect, a search over ~10k notes fills its search-cursor cache and blocks every search for 10 minutes.

No CORS setup is needed, because all HTTP calls go through the Rust side.

## Flow

1. **Connect:** checks both services.
2. **Package:** pick an `.apkg` file, or reopen one of the last five from **Recent**. All formats are supported: `anki21b` (zstd + protobuf media map), `anki21` and `anki2`.
3. **Configure:**
   - The main field (default `Tibetan`).
   - A merge tag (default `merge_<date>_<time>`) added to every note the merge writes — new notes and notes whose fields or tags change — so one `tag:` search in Anki finds the whole run. Blank disables it.
   - Where new notes go: each note's own package deck (the default when the package has several decks; missing decks are created, parents included), or one target deck for all of them.
   - Which library note type each package note type maps to: an existing one (fields matched by name) or a newly created one. Both this choice and field maps are remembered app-wide by note type names, so the next package with the same note types starts where you left off. When the two don't line up, the row shows which package fields won't be imported. **Configure fields**, below the table, opens an optional field map for those note types, described under Review, with rows colored green for same name, yellow for a different name and red for no match.
4. **Analyze and review:**
   - Each package note is matched by GUID first, then by main field across the **whole library**: any deck, any note type that has the main field (a candidate in the mapped note type is preferred). Tick **Ignore GUIDs** to match on the main field only.
   - A package note type without the main field falls back to its first field, matched only within the library note type it maps to.
   - The main-field comparison ignores markup, case, `&nbsp;`, whitespace, trailing tsheg/shad (`བཀྲ་ཤིས་` = `བཀྲ་ཤིས` = `བཀྲ་ཤིས།`) and how a stack is encoded in Unicode (U+0F43 = U+0F42 U+0FB7). This only affects matching; stored text is never changed.
   - When several package notes match the same library note they are marked ⚠, and their changes are merged into a single update. If they want different values for the same field, applying is blocked until you skip one or make them agree.
   - **New:** the note is added to its package deck or the target deck, per the setting above. Updated notes keep their current deck.
   - **Identical:** nothing to do.
   - **Auto:** only fills empty library fields and/or adds tags.
   - **Conflict:** opens the side-by-side merge, with Library | Package | Result per field, word diffs and a rendered preview. Tick the checkbox in the top-right corner of the Library or Package cell (or double-click the cell) to take that side, or tick both to combine them. You can also edit the result by hand, either as raw HTML (**Code**) or in an editor that works like Anki's own field editor (**Editor**): the field's font and size from the library note type, images inline, `[sound:…]` as text, Enter inserting `<br>`, and pasting as plain text. The Code/Editor switch in the header sets every Result cell and is remembered; the switch in a cell (or Ctrl/Cmd+Shift+X in it) changes just that cell. `E` toggles all cells. A hand-edited result is marked, and ticking a box afterwards asks before replacing your edit. Keys: `A` accept, `S` skip, `J`/`K` move between notes, `R` toggle rendered.
   - **Field mapping** (optional, collapsed): fields pair by name (case-insensitively) unless you say otherwise. When a package note type meets a library note type that doesn't line up with it — matched notes in a differently named type, or a target type with fields the other side lacks — Review shows a collapsed **Field mapping** panel listing each pair. It includes library types reached only through library-wide matching, which Configure can't know about before analysis. Open it to pick which package field fills each library field, or nothing. One package field can fill several library fields. A package field that no library field takes can be added to the library note type with **+ add field**. The field is only scheduled at that point. Apply creates it after the backup, through AnkiConnect's `modelFieldAdd`, and only if a note fills it. Card templates don't show it until you edit them, and the change makes Anki's next AnkiWeb sync a one-way full sync. Choices are remembered by note type names for later packages. A change re-classifies at once, with no trip to Anki, and resets any review decision whose package side changed.
   - Review decisions are saved per package file, so a long review can be resumed.
5. **Preview (dry run):** a full report of what the merge would write, built from the same plan Apply executes, so the two can't disagree. It covers:
   - the ordered steps and summary counts;
   - decks (and which will be created), note types (created, mapped, fields added), media and the merge tag;
   - every updated note with each field's current value, new value and why (fills empty field / package value / edited in review), plus tags added;
   - every new note with its deck, tags and fields;
   - notes left alone and why, and warnings.
   Filter by text; **Copy JSON** or **Save JSON…** to keep a record of the run.
6. **Apply:**
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
