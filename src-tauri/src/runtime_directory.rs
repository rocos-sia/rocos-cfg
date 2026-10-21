//! New-directory runtime export. A private directory is owned by the transfer
//! until every file is verified and the receipt is marked complete. Existing
//! directories are never merged, replaced or treated as our recovery staging.
use crate::files::{FileError, Result, CHUNK, MAX_FILE};
use crate::messages::{Message, MessageTemplate};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::{Builder, TempDir};
use uuid::Uuid;
const RECEIPT: &str = "ROCOS-EXPORT.json";
const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}
#[derive(Serialize)]
struct Receipt<'a> {
    format: &'static str,
    version: u8,
    status: &'static str,
    files: &'a [Entry],
}
struct Transfer {
    directory: TempDir,
    entries: Vec<Entry>,
    written: Vec<u64>,
}
#[derive(Default)]
pub struct RuntimeDirectories {
    transfers: HashMap<String, Transfer>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryWritten {
    pub display_path: String,
    pub files: usize,
    pub warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning_text: Option<MessageTemplate>,
}
fn invalid(message: &'static str) -> FileError {
    FileError::localized("directory-export", message)
}
fn components(path: &str) -> Result<Vec<&str>> {
    if path.len() > 4096
        || path
            .chars()
            .any(|c| c.is_control() || "\\:*?\"<>|".contains(c))
    {
        return Err(invalid("导出路径包含非法字符"));
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 64
        || parts.iter().any(|p| {
            let stem = p.split('.').next().unwrap_or("").to_ascii_uppercase();
            p.is_empty()
                || *p == "."
                || *p == ".."
                || p.ends_with([' ', '.'])
                || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
                || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.len() == 4
                    && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        })
    {
        return Err(invalid("导出路径不是可移植的相对文件路径"));
    }
    Ok(parts)
}
pub fn validate_entries(entries: &[Entry]) -> Result<()> {
    if entries.is_empty() || entries.len() > 10_000 {
        return Err(invalid("导出文件数量无效"));
    }
    let mut files = HashSet::new();
    let mut dirs = HashSet::new();
    let mut total = 0u64;
    files.insert(RECEIPT.to_lowercase());
    for e in entries {
        let parts = components(&e.path)?;
        if e.size > MAX_FILE
            || e.sha256.len() != 64
            || !e.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(invalid("导出文件大小或哈希无效"));
        }
        total = total
            .checked_add(e.size)
            .ok_or_else(|| invalid("导出文件超过限额"))?;
        if total > MAX_TOTAL {
            return Err(invalid("导出文件超过限额"));
        }
        let path = e.path.to_lowercase();
        if files.contains(&path) || dirs.contains(&path) {
            return Err(invalid("导出路径重复或文件/目录冲突"));
        }
        for n in 1..parts.len() {
            let dir = parts[..n].join("/").to_lowercase();
            if files.contains(&dir) {
                return Err(invalid("导出路径重复或文件/目录冲突"));
            }
            dirs.insert(dir);
        }
        files.insert(path);
    }
    Ok(())
}
fn checked_file(root: &Path, relative: &str, create: bool) -> Result<PathBuf> {
    let parts = components(relative)?;
    let mut path = root.to_owned();
    if fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(invalid("暂存目录发生变化"));
    }
    for part in &parts[..parts.len() - 1] {
        path.push(part);
        if create && !path.exists() {
            fs::create_dir(&path)?;
        }
        let m = fs::symlink_metadata(&path)?;
        if !m.is_dir() || m.file_type().is_symlink() {
            return Err(invalid("暂存路径包含非目录或符号链接"));
        }
    }
    path.push(parts.last().unwrap());
    if !create {
        let m = fs::symlink_metadata(&path)?;
        if !m.is_file() || m.file_type().is_symlink() {
            return Err(invalid("暂存文件发生变化"));
        }
    }
    Ok(path)
}
fn receipt(root: &Path, entries: &[Entry], status: &'static str) -> Result<()> {
    let mut file = Builder::new().prefix(".receipt-").tempfile_in(root)?;
    serde_json::to_writer_pretty(
        &mut file,
        &Receipt {
            format: "ROCOS runtime export",
            version: 1,
            status,
            files: entries,
        },
    )
    .map_err(|e| {
        FileError::detail(
            "directory-export",
            "无法写入导出清单：{detail}",
            e.to_string(),
        )
    })?;
    file.write_all(b"\n")?;
    file.as_file().sync_all()?;
    file.persist(root.join(RECEIPT))
        .map_err(|e| FileError::from(e.error))?;
    Ok(())
}
fn verified(path: &Path, e: &Entry) -> Result<()> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > e.size {
            return Err(invalid("暂存文件长度校验失败"));
        }
        hash.update(&buffer[..n]);
    }
    if size != e.size || format!("{:x}", hash.finalize()) != e.sha256.to_ascii_lowercase() {
        return Err(invalid("暂存文件哈希校验失败"));
    }
    file.sync_all()?;
    Ok(())
}
impl RuntimeDirectories {
    // Parent comes only from a native folder picker, never a frontend path.
    pub fn begin(&mut self, parent: &Path, name: &str, entries: Vec<Entry>) -> Result<String> {
        validate_entries(&entries)?;
        if self.transfers.len() >= 2 {
            return Err(invalid("已有目录导出任务，请先完成或取消"));
        }
        let metadata = fs::symlink_metadata(parent)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(invalid("请选择普通父目录"));
        }
        let parent = fs::canonicalize(parent)?;
        let prefix: String = name
            .chars()
            .take(60)
            .map(|c| {
                if c.is_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let directory = Builder::new()
            .prefix(&format!(
                "{}-config-",
                if prefix.is_empty() { "rocos" } else { &prefix }
            ))
            .tempdir_in(parent)?;
        receipt(directory.path(), &entries, "incomplete")?;
        for e in &entries {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(checked_file(directory.path(), &e.path, true)?)?;
        }
        let token = Uuid::new_v4().to_string();
        let written = vec![0; entries.len()];
        self.transfers.insert(
            token.clone(),
            Transfer {
                directory,
                entries,
                written,
            },
        );
        Ok(token)
    }
    pub fn append(&mut self, token: &str, index: usize, offset: u64, bytes: &[u8]) -> Result<()> {
        let t = self
            .transfers
            .get_mut(token)
            .ok_or_else(|| invalid("目录导出任务已失效"))?;
        let e = t
            .entries
            .get(index)
            .ok_or_else(|| invalid("导出文件序号无效"))?;
        if offset != t.written[index] || bytes.len() > CHUNK || bytes.len() as u64 > e.size - offset
        {
            return Err(invalid("导出分块的顺序或长度无效"));
        }
        let mut file = OpenOptions::new().append(true).open(checked_file(
            t.directory.path(),
            &e.path,
            false,
        )?)?;
        if file.metadata()?.len() != offset {
            return Err(invalid("暂存文件被外部修改"));
        }
        file.write_all(bytes)?;
        t.written[index] += bytes.len() as u64;
        Ok(())
    }
    pub fn cancel(&mut self, token: &str) -> Result<()> {
        if let Some(t) = self.transfers.remove(token) {
            t.directory.close()?;
        }
        Ok(())
    }
    pub fn finish(&mut self, token: &str) -> Result<DirectoryWritten> {
        let t = self
            .transfers
            .get(token)
            .ok_or_else(|| invalid("目录导出任务已失效"))?;
        for (i, e) in t.entries.iter().enumerate() {
            if t.written[i] != e.size {
                return Err(invalid("目录导出尚未完成"));
            }
            verified(&checked_file(t.directory.path(), &e.path, false)?, e)?;
        }
        receipt(t.directory.path(), &t.entries, "complete")?;
        #[cfg(unix)]
        let warning = (|| -> std::io::Result<()> {
            let mut dirs = HashSet::new();
            dirs.insert(t.directory.path().to_owned());
            if let Some(parent) = t.directory.path().parent() {
                dirs.insert(parent.to_owned());
            }
            for e in &t.entries {
                let mut p = t.directory.path().join(&e.path);
                while p.pop() && p.starts_with(t.directory.path()) {
                    dirs.insert(p.clone());
                }
            }
            for dir in dirs {
                File::open(dir)?.sync_all()?;
            }
            Ok(())
        })()
        .err()
        .map(|e| Message::detail("文件已校验，但目录同步失败：{detail}", e.to_string()));
        #[cfg(not(unix))]
        let warning: Option<Message> = None;
        let t = self.transfers.remove(token).unwrap();
        let files = t.entries.len();
        let path = t.directory.keep();
        Ok(DirectoryWritten {
            display_path: path.to_string_lossy().into_owned(),
            files,
            warning: warning.as_ref().map(|m| m.message.clone()),
            warning_text: warning.map(|m| m.text),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn entry(path: &str, data: &[u8]) -> Entry {
        Entry {
            path: path.into(),
            size: data.len() as u64,
            sha256: format!("{:x}", Sha256::digest(data)),
        }
    }
    #[test]
    fn complete_export_is_verified_and_never_overwrites_existing_content() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("keep"), b"original").unwrap();
        let mut d = RuntimeDirectories::default();
        let entries = vec![
            entry("app/config.yaml", b"config"),
            entry("eni.xml", b"exact eni"),
            entry("empty", b""),
        ];
        let t = d.begin(root.path(), "robot", entries).unwrap();
        d.append(&t, 0, 0, b"con").unwrap();
        d.append(&t, 0, 3, b"fig").unwrap();
        d.append(&t, 1, 0, b"exact eni").unwrap();
        let result = d.finish(&t).unwrap();
        let path = Path::new(&result.display_path);
        assert_eq!(fs::read(path.join("eni.xml")).unwrap(), b"exact eni");
        assert_eq!(fs::read(root.path().join("keep")).unwrap(), b"original");
        let receipt: serde_json::Value =
            serde_json::from_slice(&fs::read(path.join(RECEIPT)).unwrap()).unwrap();
        assert_eq!(receipt["status"], "complete");
        assert_eq!(receipt["files"].as_array().unwrap().len(), 3);
        assert!(d.append(&t, 0, 0, b"").is_err());
    }
    #[test]
    fn cancellation_incomplete_and_corrupt_writes_do_not_publish() {
        let root = tempfile::tempdir().unwrap();
        let mut d = RuntimeDirectories::default();
        let t = d
            .begin(root.path(), "robot", vec![entry("config", b"good")])
            .unwrap();
        let path = d.transfers[&t].directory.path().to_owned();
        assert!(d.append(&t, 0, 1, b"x").is_err());
        assert!(d.append(&t, 0, 0, b"oversize").is_err());
        assert!(d.finish(&t).is_err());
        d.append(&t, 0, 0, b"evil").unwrap();
        assert!(d.finish(&t).is_err());
        let receipt: serde_json::Value =
            serde_json::from_slice(&fs::read(path.join(RECEIPT)).unwrap()).unwrap();
        assert_eq!(receipt["status"], "incomplete");
        d.cancel(&t).unwrap();
        assert!(!path.exists());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
    #[test]
    fn rejects_escape_collisions_and_invalid_sizes_before_writing() {
        let root = tempfile::tempdir().unwrap();
        let mut d = RuntimeDirectories::default();
        for path in [
            "../outside",
            "/absolute",
            "C:/a",
            "a\\b",
            "a//b",
            "a/./b",
            "NUL",
            "com1.txt",
            "a.",
            RECEIPT,
        ] {
            assert!(
                d.begin(root.path(), "r", vec![entry(path, b"")]).is_err(),
                "{}",
                path
            );
        }
        for pair in [("a", "A"), ("a", "a/b"), ("a/b", "A")] {
            assert!(d
                .begin(
                    root.path(),
                    "r",
                    vec![entry(pair.0, b""), entry(pair.1, b"")]
                )
                .is_err());
        }
        let mut e = entry("a", b"");
        e.size = MAX_FILE + 1;
        assert!(d.begin(root.path(), "r", vec![e]).is_err());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
    #[test]
    fn external_modification_is_detected_before_completion() {
        let root = tempfile::tempdir().unwrap();
        let mut d = RuntimeDirectories::default();
        let t = d.begin(root.path(), "r", vec![entry("a", b"ok")]).unwrap();
        d.append(&t, 0, 0, b"ok").unwrap();
        fs::write(d.transfers[&t].directory.path().join("a"), b"xx").unwrap();
        assert!(d.finish(&t).is_err());
        d.cancel(&t).unwrap();
    }
    #[test]
    #[cfg(unix)]
    fn rejects_symlink_parents_and_modified_staging_paths() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let mut d = RuntimeDirectories::default();
        symlink(outside.path(), root.path().join("link")).unwrap();
        assert!(d
            .begin(&root.path().join("link"), "r", vec![entry("a", b"x")])
            .is_err());
        let t = d
            .begin(root.path(), "r", vec![entry("sub/a", b"x")])
            .unwrap();
        let path = d.transfers[&t].directory.path().join("sub");
        fs::remove_dir_all(&path).unwrap();
        symlink(outside.path(), &path).unwrap();
        assert!(d.append(&t, 0, 0, b"x").is_err());
        d.cancel(&t).unwrap();
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }
}
