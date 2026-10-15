# Anki Merge Tool

Desktop app (Tauri 2 + Vue 3) that merges an `.apkg` package **directly into your live Anki library** — matching notes, letting you resolve conflicting fields side by side, and writing the result through AnkiConnect. Every merge starts with a full collection backup.

Successor to `../anki-merge-vue` (an Electron scaffold that never worked end to end).

## Requirements

Anki must be open with two add-ons:

- **AnkiConnect** (AnkiWeb code `2055492159`) on `127.0.0.1:8765`: reads and writes notes, media, decks and note types.
- **anki-ai-bridge** (`../anki-ai-bridge`) on `127.0.0.1:8766`, a version that has `POST /backup`, `POST /notes/by-guid` and `POST /notes/field-values`:
  - `/backup` creates the pre-merge `.colpkg` backup, which stock AnkiConnect can't do.
  - `/notes/by-guid` supports GUID matching; AnkiConnect's `notesInfo` doesn't return GUIDs.
  - `/notes/field-values` reads the main field of every note in one pass, for matching and for finding possible duplicates in other note types. AnkiConnect `findNotes` isn't used: on Anki 26.8+ AnkiConnect, a search over ~10k notes fills its search-cursor cache and blocks every search for 10 minutes.

No CORS setup is needed, because all HTTP calls go through the Rust side.

## Flow

The app picks up where you left off. It remembers the open package and step. On launch it reconnects, reopens the package, re-analyzes the library when the step needs it (Note types, Review, Preview, Apply), and returns to that step. If Anki can't be reached, the package can't be opened or the analysis fails, it stops on that step with a notice and **Retry**; **Start over instead** forgets the place.

1. **Connect:** checks both services.
2. **Package:** pick an `.apkg` file, or reopen one of the last five from **Recent**. All formats are supported: `anki21b` (zstd + protobuf media map), `anki21` and `anki2`.
3. **Configure:**
   - The main field (default `Tibetan`).
   - A merge tag (default `merge_<date>_<time>`) added to every note the merge writes — new notes and notes whose fields or tags change — so one `tag:` search in Anki finds the whole run. Blank disables it.
   - Where new notes go: each note's own package deck (the default when the package has several decks; missing decks are created, parents included), or one target deck for all of them.
4. **Note types** (after every analysis; also reachable from the nav or Review's **edit** link):
   - **Note types**, on top: for each package note type, the library note type it maps to, either an existing one or **Create new note type** (named after the package type, editable). The mapping is declarative: the type's notes are matched only against notes of that library type, and its new notes are added to it. The first analysis uses the remembered choice, else the same-named library type, else a new one. Changing it re-analyzes; review decisions carry over where the library note is unchanged. The choice is remembered app-wide by note type names. The Notes column also counts each type's possible duplicates (see Review).
   - **Fields**, below: a field map for each package type → library type pair, used for its new notes and its matched notes. Then, under **Merged into other note types**, a map for each pair that only exists because you chose, under Possible duplicates, to merge a note into an existing note of another type.

   Fields pair by name (case-insensitively) unless you say otherwise. Each pair's table starts collapsed, with the pair's note counts and any package fields not imported (or "fields line up by name") shown in its header; click it to open. Which pairs are open is remembered by note type names across sessions. For each pair, pick which package field fills each library field, or nothing; rows are colored green for same name, yellow for a different name and red for no match. One package field can fill several library fields. A package field that no library field takes can be added to the library note type with **+ add field**. The field is only scheduled at that point. Apply creates it after the backup, through AnkiConnect's `modelFieldAdd`, and only if a note fills it. Card templates don't show it until you edit them, and the change makes Anki's next AnkiWeb sync a one-way full sync. Choices are remembered by note type names for later packages. A change re-classifies at once, with no trip to Anki, and resets any review decision whose package side changed.
5. **Review:** nothing is written unless you accept it. Every new note, auto-merge and conflict starts pending; tick new notes and auto-merges (or use **Accept all** on their tab, or **Accept all without conflicts** for both at once) and accept conflicts one by one.
   - Each package note is matched only against its declared library note type: by GUID first, then by main field. Tick **Ignore GUIDs** to match on the main field only.
   - When several library notes share the main field, all of them are loaded and the closest is used. Closest means the most fields with the same content as the package note. After that, a note with content of its own beats an empty stub that only repeats the main field, then the note with more fields filled. Such a match is marked ⚠ and always goes to **Conflicts**, even when it would only fill empty fields. There, the merge view lists every candidate with a glimpse of its fields; click one to merge into it instead (the choice is saved with the session), or **Open in Anki** to look at it in Browse.
   - **Possible duplicates:** a package note with no match in its declared type whose GUID or main field exists in **another** library note type (say, a Tibetan Phrase whose Tibetan you keep as a Tibetan Cluster note). Adding it would create a duplicate, so it isn't listed under New; this tab lists each one beside the existing notes, with **Open in Anki**, and asks for a decision: **Add as new** (to its declared type), **Don't add**, or **Merge into this note** (the package note is merged into that existing note in its own type, as an auto-merge, accepted with the choice, or a conflict to accept). **undo** makes it undecided again. Undecided ones aren't written; bulk buttons add or leave out all the undecided at once. Decisions are saved with the session.
   - A package note type without the main field falls back to its first field, matched only within the library note type it maps to.
   - The main-field comparison ignores markup, case, `&nbsp;`, whitespace, trailing tsheg/shad (`བཀྲ་ཤིས་` = `བཀྲ་ཤིས` = `བཀྲ་ཤིས།`) and how a stack is encoded in Unicode (U+0F43 = U+0F42 U+0FB7). This only affects matching; stored text is never changed.
   - When several package notes match the same library note they are also marked ⚠, and their changes are merged into a single update. If they want different values for the same field, applying is blocked until you skip one or make them agree.
   - **New:** the note is added to its package deck or the target deck, per the setting above. Updated notes keep their current deck.
   - **Identical:** nothing to do.
   - **Auto:** only fills empty library fields and/or adds tags.
   - **Conflict:** opens the side-by-side merge, with Library | Package | Result per field, word diffs and a rendered preview. Click the Library or Package cell to take that side (it turns light blue); click both to combine them, and shift-click one to take only that side. You can also edit the result by hand, either as raw HTML (**Code**) or in an editor that works like Anki's own field editor (**Editor**): the field's font and size from the library note type, images inline, `[sound:…]` as text, Enter inserting `<br>`, and pasting as plain text. The Code/Editor switch in the header sets every Result cell and is remembered; the switch in a cell (or Ctrl/Cmd+Shift+X in it) changes just that cell. `E` toggles all cells. A hand-edited result is marked, and ticking a box afterwards asks before replacing your edit. Keys: `A` accept, `S` skip, `J`/`K` move between notes, `R` toggle rendered. **Rendered** is remembered too, across notes and sessions, and applies to the Merged tab as well.
   - **Sessions:** once analysis has run, everything is saved next to the package as `<name>.apkg.merge.json` on every change: the Configure choices, decisions, accepted notes, and the ledger of notes already merged. **Recent** on the Package step shows each package's progress with a **Resume** button that reopens it, re-analyzes against the live library, and lands on Review. Saved decisions are kept where the library note is unchanged; the rest reset.
   - **Merged** tab: notes an earlier run wrote. They are read-only and are never merged again, whatever a later analysis says about them; each shows what was written, and flags a note that has since changed in Anki or is no longer in the library.
6. **Preview (dry run):** a full report of what the merge would write, built from the same plan Apply executes, so the two can't disagree. It covers:
   - the ordered steps and summary counts;
   - decks (and which will be created), note types (created, mapped, fields added), media and the merge tag;
   - every updated note with each field's current value, new value and why (fills empty field / package value / edited in review), plus tags added;
   - every new note with its deck, tags and fields;
   - notes left alone and why (not accepted, conflict skipped or undecided, already merged), and warnings for the notes being written.
   Filter by text; **Copy JSON** or **Save JSON…** to keep a record of the run.
7. **Apply:** writes the accepted notes — accepted conflicts, plus ticked auto-merges and new notes — that aren't merged yet. Approve some, merge, approve more, merge again: each run only writes the rest, and a half-finished run leaves what landed in the ledger and what failed still approved. One merge tag covers every run on the package.
   - Runs the backup first and stops if it fails.
   - Then creates the deck and note types, copies the media referenced by written notes, adds notes, updates fields and adds tags.
   - Media: images and sounds referenced by written notes are copied, including `[_sound:…]`, a custom tag for sounds that shouldn't autoplay; the app plays and previews it like `[sound:…]`. A library file with the same name but different content is never overwritten. Anki stores ours under a new name and the note fields are rewritten to match.
   - Restore a backup with **File → Switch Profile → Open Backup** in Anki.

## Limitations

- New notes get fresh GUIDs, because AnkiConnect's `addNote` can't set them. The session file records the id Anki assigned, so later runs find them again; without it (a deleted session file, or another machine), re-merging matches those notes by main field, not GUID.
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
- `src/lib/`: pure logic (`match.js`, `applyMerge.js`, `session.js` for the session file and merged ledger) and the client (`ankiClient.js`).
- `src/composables/useMergeSession.js`: session state.
- `src/components/`: the step views and `ConflictMerge.vue`.

Parser fixtures in `src-tauri/tests/fixtures/` are copied from `../anki-apkg-parser/test/decks/`.

The app icon is `src-tauri/app-icon.svg`; `npx tauri icon src-tauri/app-icon.svg` regenerates `src-tauri/icons/` from it.
