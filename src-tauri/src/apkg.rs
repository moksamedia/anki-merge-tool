//! Reads Anki .apkg packages in all three on-disk formats:
//! - `collection.anki21b`: zstd-compressed SQLite (schema 18), protobuf media map,
//!   zstd-compressed media files (Anki 2.1.50+ default export)
//! - `collection.anki21`: plain SQLite (schema 11), JSON media map
//! - `collection.anki2`: plain SQLite (schema 11), JSON media map (oldest)
//!
//! Newer exports also contain a placeholder `collection.anki2`, so the newest
//! collection file present always wins.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use anyhow::{anyhow, bail, Context, Result};
use prost::Message;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use zip::ZipArchive;

const ZSTD_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub format: String,
    pub notetypes: Vec<Notetype>,
    pub decks: Vec<Deck>,
    pub notes: Vec<Note>,
    pub media: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Notetype {
    pub id: i64,
    pub name: String,
    pub is_cloze: bool,
    pub fields: Vec<String>,
    pub templates: Vec<Template>,
    pub css: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub name: String,
    pub qfmt: String,
    pub afmt: String,
}

#[derive(Debug, Serialize)]
pub struct Deck {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub guid: String,
    pub notetype_id: i64,
    pub fields: Vec<String>,
    pub tags: Vec<String>,
    pub modified: i64,
    pub deck_id: Option<i64>,
}

// Minimal mirrors of anki/proto/anki/{import_export,notetypes}.proto.
// prost skips fields not declared here.
#[derive(Clone, PartialEq, Message)]
struct MediaEntries {
    #[prost(message, repeated, tag = "1")]
    entries: Vec<MediaEntry>,
}

#[derive(Clone, PartialEq, Message)]
struct MediaEntry {
    #[prost(string, tag = "1")]
    name: String,
    #[prost(uint32, optional, tag = "255")]
    legacy_zip_filename: Option<u32>,
}

#[derive(Clone, PartialEq, Message)]
struct NotetypeConfig {
    #[prost(int32, tag = "1")]
    kind: i32,
    #[prost(string, tag = "3")]
    css: String,
}

#[derive(Clone, PartialEq, Message)]
struct TemplateConfig {
    #[prost(string, tag = "1")]
    q_format: String,
    #[prost(string, tag = "2")]
    a_format: String,
}

fn maybe_zstd(bytes: Vec<u8>) -> Result<Vec<u8>> {
    if bytes.starts_with(&ZSTD_MAGIC) {
        zstd::decode_all(bytes.as_slice()).context("zstd decompression failed")
    } else {
        Ok(bytes)
    }
}

fn read_entry(zip: &mut ZipArchive<File>, name: &str) -> Result<Option<Vec<u8>>> {
    let mut entry = match zip.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)?;
    Ok(Some(buf))
}

fn open_zip(path: &Path) -> Result<ZipArchive<File>> {
    let file = File::open(path).with_context(|| format!("cannot open {}", path.display()))?;
    ZipArchive::new(file).context("not a valid .apkg (zip) file")
}

/// Media map: real filename -> name of the zip entry holding its bytes.
fn media_map(zip: &mut ZipArchive<File>) -> Result<HashMap<String, String>> {
    let Some(raw) = read_entry(zip, "media")? else {
        return Ok(HashMap::new());
    };
    let raw = maybe_zstd(raw)?;
    // Legacy packages store {"0": "file.jpg"}; latest store protobuf MediaEntries,
    // where entry i lives at zip name "i" unless legacy_zip_filename is set.
    if let Ok(json) = serde_json::from_slice::<HashMap<String, String>>(&raw) {
        return Ok(json.into_iter().map(|(zip_name, name)| (name, zip_name)).collect());
    }
    let entries = MediaEntries::decode(raw.as_slice()).context("unreadable media map")?;
    Ok(entries
        .entries
        .into_iter()
        .enumerate()
        .map(|(i, e)| {
            let zip_name = e.legacy_zip_filename.map_or(i as u32, |n| n).to_string();
            (e.name, zip_name)
        })
        .collect())
}

pub fn parse(path: &Path) -> Result<Package> {
    let mut zip = open_zip(path)?;

    let (format, db_bytes) = ["collection.anki21b", "collection.anki21", "collection.anki2"]
        .iter()
        .find_map(|name| match read_entry(&mut zip, name) {
            Ok(Some(bytes)) => Some(Ok((name.trim_start_matches("collection."), bytes))),
            Ok(None) => None,
            Err(e) => Some(Err(e)),
        })
        .ok_or_else(|| anyhow!("package contains no Anki collection"))??;
    let db_bytes = maybe_zstd(db_bytes)?;

    // rusqlite needs a real file; the temp file is deleted when `tmp` drops.
    let mut tmp = tempfile::NamedTempFile::new()?;
    tmp.write_all(&db_bytes)?;
    tmp.flush()?;
    let conn = Connection::open_with_flags(tmp.path(), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .context("cannot open package collection")?;
    // Schema 18 indexes names with Anki's custom `unicase` collation; SQLite
    // refuses to plan queries on those tables until it is registered.
    conn.create_collation("unicase", |a, b| a.to_lowercase().cmp(&b.to_lowercase()))?;

    let modern = has_table(&conn, "notetypes")?;
    let (notetypes, decks) = if modern {
        (modern_notetypes(&conn)?, modern_decks(&conn)?)
    } else {
        (legacy_notetypes(&conn)?, legacy_decks(&conn)?)
    };

    let mut media: Vec<String> = media_map(&mut zip)?.into_keys().collect();
    media.sort();

    Ok(Package {
        format: format.to_string(),
        notetypes,
        decks,
        notes: notes(&conn)?,
        media,
    })
}

/// Returns base64-encoded bytes for the requested media filenames.
/// Names missing from the package are omitted.
pub fn read_media(path: &Path, names: &[String]) -> Result<HashMap<String, String>> {
    use base64::Engine;
    let mut zip = open_zip(path)?;
    let map = media_map(&mut zip)?;
    let mut out = HashMap::new();
    for name in names {
        let Some(zip_name) = map.get(name) else { continue };
        let Some(bytes) = read_entry(&mut zip, zip_name)? else { continue };
        let bytes = maybe_zstd(bytes)?;
        out.insert(name.clone(), base64::engine::general_purpose::STANDARD.encode(bytes));
    }
    Ok(out)
}

fn has_table(conn: &Connection, name: &str) -> Result<bool> {
    let count: i64 = conn.query_row(
        "select count(*) from sqlite_master where type = 'table' and name = ?",
        [name],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

fn modern_notetypes(conn: &Connection) -> Result<Vec<Notetype>> {
    let mut fields: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare("select ntid, name from fields order by ntid, ord")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (ntid, name) = row?;
        fields.entry(ntid).or_default().push(name);
    }

    let mut templates: HashMap<i64, Vec<Template>> = HashMap::new();
    let mut stmt = conn.prepare("select ntid, name, config from templates order by ntid, ord")?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Vec<u8>>(2)?))
    })? {
        let (ntid, name, config) = row?;
        let config = TemplateConfig::decode(config.as_slice())?;
        templates.entry(ntid).or_default().push(Template {
            name,
            qfmt: config.q_format,
            afmt: config.a_format,
        });
    }

    let mut stmt = conn.prepare("select id, name, config from notetypes")?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Vec<u8>>(2)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, config) = row?;
        let config = NotetypeConfig::decode(config.as_slice())?;
        out.push(Notetype {
            id,
            name,
            is_cloze: config.kind == 1,
            fields: fields.remove(&id).unwrap_or_default(),
            templates: templates.remove(&id).unwrap_or_default(),
            css: config.css,
        });
    }
    Ok(out)
}

fn modern_decks(conn: &Connection) -> Result<Vec<Deck>> {
    let mut stmt = conn.prepare("select id, name from decks")?;
    let rows = stmt.query_map([], |r| {
        Ok(Deck {
            id: r.get(0)?,
            // Schema 18 separates deck levels with \x1f instead of "::".
            name: r.get::<_, String>(1)?.replace('\x1f', "::"),
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn legacy_col_json(conn: &Connection, column: &str) -> Result<serde_json::Value> {
    let raw: String = conn.query_row(&format!("select {column} from col"), [], |r| r.get(0))?;
    serde_json::from_str(&raw).with_context(|| format!("invalid col.{column} JSON"))
}

fn legacy_notetypes(conn: &Connection) -> Result<Vec<Notetype>> {
    let models = legacy_col_json(conn, "models")?;
    let models = models.as_object().ok_or_else(|| anyhow!("col.models is not an object"))?;
    let str_of = |v: &serde_json::Value, k: &str| v[k].as_str().unwrap_or_default().to_string();

    let mut out = Vec::new();
    for model in models.values() {
        let mut flds: Vec<&serde_json::Value> =
            model["flds"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        flds.sort_by_key(|f| f["ord"].as_i64());
        let mut tmpls: Vec<&serde_json::Value> =
            model["tmpls"].as_array().map(|a| a.iter().collect()).unwrap_or_default();
        tmpls.sort_by_key(|t| t["ord"].as_i64());

        out.push(Notetype {
            id: model["id"]
                .as_i64()
                .or_else(|| model["id"].as_str().and_then(|s| s.parse().ok()))
                .ok_or_else(|| anyhow!("note type without id"))?,
            name: str_of(model, "name"),
            is_cloze: model["type"].as_i64() == Some(1),
            fields: flds.iter().map(|f| str_of(f, "name")).collect(),
            templates: tmpls
                .iter()
                .map(|t| Template {
                    name: str_of(t, "name"),
                    qfmt: str_of(t, "qfmt"),
                    afmt: str_of(t, "afmt"),
                })
                .collect(),
            css: str_of(model, "css"),
        });
    }
    Ok(out)
}

fn legacy_decks(conn: &Connection) -> Result<Vec<Deck>> {
    let decks = legacy_col_json(conn, "decks")?;
    let decks = decks.as_object().ok_or_else(|| anyhow!("col.decks is not an object"))?;
    Ok(decks
        .iter()
        .filter_map(|(id, d)| {
            Some(Deck {
                id: id.parse().ok()?,
                name: d["name"].as_str()?.to_string(),
            })
        })
        .collect())
}

fn notes(conn: &Connection) -> Result<Vec<Note>> {
    // Deck of each note's first card; new notes are added to a single deck anyway.
    let mut first_deck: HashMap<i64, i64> = HashMap::new();
    let mut stmt = conn.prepare("select nid, did from cards order by nid, ord")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (nid, did) = row?;
        first_deck.entry(nid).or_insert(did);
    }

    let mut stmt = conn.prepare("select id, guid, mid, flds, tags, mod from notes order by id")?;
    let rows = stmt.query_map([], |r| {
        let id: i64 = r.get(0)?;
        Ok(Note {
            id,
            guid: r.get(1)?,
            notetype_id: r.get(2)?,
            fields: r.get::<_, String>(3)?.split('\x1f').map(str::to_string).collect(),
            tags: r.get::<_, String>(4)?.split_whitespace().map(str::to_string).collect(),
            modified: r.get(5)?,
            deck_id: first_deck.get(&id).copied(),
        })
    })?;
    let notes: Vec<Note> = rows.collect::<Result<_, _>>()?;
    if notes.is_empty() {
        bail!("package contains no notes");
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    fn check_consistent(pkg: &Package) {
        for note in &pkg.notes {
            let nt = pkg
                .notetypes
                .iter()
                .find(|nt| nt.id == note.notetype_id)
                .expect("note references a known notetype");
            assert_eq!(note.fields.len(), nt.fields.len(), "field count matches notetype");
            assert!(!note.guid.is_empty());
        }
        for nt in &pkg.notetypes {
            assert!(!nt.templates.is_empty(), "{} has templates", nt.name);
            assert!(!nt.templates[0].qfmt.is_empty());
        }
    }

    #[test]
    fn parses_legacy_deck() {
        let pkg = parse(&fixture("legacy_deck.apkg")).unwrap();
        assert_ne!(pkg.format, "anki21b");
        check_consistent(&pkg);
    }

    #[test]
    fn parses_new_deck() {
        let pkg = parse(&fixture("new_deck.apkg")).unwrap();
        assert_eq!(pkg.format, "anki21b");
        check_consistent(&pkg);
    }

    #[test]
    fn reads_media_in_both_formats() {
        for name in ["deck_media_old.apkg", "deck_media_new.apkg"] {
            let path = fixture(name);
            let pkg = parse(&path).unwrap();
            check_consistent(&pkg);
            assert!(!pkg.media.is_empty(), "{name} lists media");
            let blobs = read_media(&path, &pkg.media).unwrap();
            assert_eq!(blobs.len(), pkg.media.len(), "{name}: every listed file is readable");
            // Decompressed media must not still carry the zstd header.
            use base64::Engine;
            for b64 in blobs.values() {
                let bytes = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
                assert!(!bytes.starts_with(&ZSTD_MAGIC));
            }
        }
    }

    #[test]
    fn rejects_broken_package() {
        let err = parse(&fixture("broken_deck.apkg")).unwrap_err();
        assert!(err.to_string().contains("not a valid .apkg"));
    }
}
