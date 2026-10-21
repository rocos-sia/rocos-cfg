//! File capabilities exist only for paths selected in a native dialog. Absolute
//! host paths never enter the portable project model or its archive manifest.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use tempfile::{Builder, NamedTempFile};
use uuid::Uuid;

pub const MAX_ARCHIVE: u64 = 1024 * 1024 * 1024 + 1024 * 1024;
pub const MAX_FILE: u64 = 256 * 1024 * 1024;
pub const CHUNK: usize = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileError {
    pub code: String,
    pub message: String,
    pub current_hash: Option<String>,
}
impl FileError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            current_hash: None,
        }
    }
    fn conflict(hash: Option<String>) -> Self {
        Self {
            code: "conflict".into(),
            message: "文件已被外部修改或删除；请选择另存为，或先查看磁盘版本。".into(),
            current_hash: hash,
        }
    }
}
impl From<std::io::Error> for FileError {
    fn from(e: std::io::Error) -> Self {
        Self::new("io", e.to_string())
    }
}
pub type Result<T> = std::result::Result<T, FileError>;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handle {
    pub token: String,
    pub name: String,
    pub display_path: String,
    pub size: u64,
    pub sha256: Option<String>,
    pub relative_path: Option<String>,
}
struct Grant {
    path: PathBuf,
    handle: Handle,
    writable: bool,
}
struct Upload {
    target: String,
    temp: NamedTempFile,
    expected: Option<String>,
    hash: String,
    length: u64,
    written: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    pub handle: Handle,
    pub backup_path: Option<String>,
    pub warning: Option<String>,
}
#[derive(Default)]
pub struct Files {
    grants: HashMap<String, Grant>,
    uploads: HashMap<String, Upload>,
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn checked_path(path: &Path) -> Result<PathBuf> {
    let name = path
        .file_name()
        .ok_or_else(|| FileError::new("path", "需要文件路径"))?;
    let parent = fs::canonicalize(
        path.parent()
            .ok_or_else(|| FileError::new("path", "缺少父目录"))?,
    )?;
    let result = parent.join(name);
    match fs::symlink_metadata(&result) {
        Ok(m) if !m.is_file() || m.file_type().is_symlink() => {
            return Err(FileError::new(
                "path",
                "请选择普通文件，不支持符号链接或目录",
            ))
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
        _ => {}
    }
    Ok(result)
}
fn hash_file(path: &Path) -> Result<Option<(String, u64)>> {
    let path = checked_path(path)?;
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let size = file.metadata()?.len();
    if size > MAX_ARCHIVE {
        return Err(FileError::new("limit", "文件超过工程大小限额"));
    }
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_ARCHIVE {
            return Err(FileError::new("limit", "文件读取期间超过限额"));
        }
        hasher.update(&buf[..n]);
    }
    if total != size {
        return Err(FileError::new("changed", "文件在读取过程中发生变化"));
    }
    Ok(Some((format!("{:x}", hasher.finalize()), size)))
}
fn current_hash(path: &Path) -> Result<Option<String>> {
    Ok(hash_file(path)?.map(|v| v.0))
}
impl Files {
    // Call only with paths obtained from trusted native dialogs (or native tests).
    pub fn grant(
        &mut self,
        path: &Path,
        writable: bool,
        relative_path: Option<String>,
    ) -> Result<Handle> {
        if self.grants.len() >= MAX_ENTRIES + 64 {
            return Err(FileError::new("limit", "打开的文件过多，请完成导入后重试"));
        }
        let path = checked_path(path)?;
        let state = hash_file(&path)?;
        if state.is_none() && !writable {
            return Err(FileError::new("missing", "文件不存在"));
        }
        let handle = Handle {
            token: id(),
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
            display_path: path.to_string_lossy().into_owned(),
            size: state.as_ref().map_or(0, |v| v.1),
            sha256: state.map(|v| v.0),
            relative_path,
        };
        self.grants.insert(
            handle.token.clone(),
            Grant {
                path,
                handle: handle.clone(),
                writable,
            },
        );
        Ok(handle)
    }
    pub fn ensure_distinct(&self, token: &str, exclude: &str) -> Result<()> {
        let a = self
            .grants
            .get(token)
            .ok_or_else(|| FileError::new("grant", "保存目标已失效"))?;
        let b = self
            .grants
            .get(exclude)
            .ok_or_else(|| FileError::new("grant", "当前文件访问已失效"))?;
        #[cfg(windows)]
        let same =
            a.path.to_string_lossy().to_lowercase() == b.path.to_string_lossy().to_lowercase();
        #[cfg(not(windows))]
        let same = a.path == b.path;
        if same {
            Err(FileError::new(
                "same-target",
                "请选择其他路径，不能覆盖当前工程或受保护的原始工程包",
            ))
        } else {
            Ok(())
        }
    }
    pub fn refresh(&mut self, token: &str) -> Result<Handle> {
        let g = self
            .grants
            .get(token)
            .ok_or_else(|| FileError::new("grant", "文件访问已失效"))?;
        self.grant(&g.path.clone(), false, None)
    }
    pub fn read(&self, token: &str, offset: u64, length: usize) -> Result<Vec<u8>> {
        let g = self
            .grants
            .get(token)
            .ok_or_else(|| FileError::new("grant", "文件访问已失效"))?;
        if length > CHUNK || offset > g.handle.size || length as u64 > g.handle.size - offset {
            return Err(FileError::new("range", "读取范围无效"));
        }
        let mut file = File::open(checked_path(&g.path)?)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }
    pub fn release(&mut self, token: &str) {
        if !self.uploads.values().any(|u| u.target == token) {
            self.grants.remove(token);
        }
    }
    pub fn begin(&mut self, token: &str, length: u64, hash: &str) -> Result<String> {
        if length > MAX_ARCHIVE || hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(FileError::new("limit", "无效的写入大小或 SHA-256"));
        }
        let g = self
            .grants
            .get(token)
            .ok_or_else(|| FileError::new("grant", "文件访问已失效"))?;
        if !g.writable {
            return Err(FileError::new("readonly", "此文件仅允许读取"));
        }
        if self
            .uploads
            .values()
            .any(|u| self.grants.get(&u.target).is_some_and(|v| v.path == g.path))
        {
            return Err(FileError::new("busy", "该文件已有保存任务"));
        }
        let actual = current_hash(&g.path)?;
        if actual != g.handle.sha256 {
            return Err(FileError::conflict(actual));
        }
        let temp = Builder::new()
            .prefix(".rocos-save-")
            .tempfile_in(g.path.parent().unwrap())?;
        let upload = id();
        self.uploads.insert(
            upload.clone(),
            Upload {
                target: token.into(),
                temp,
                expected: actual,
                hash: hash.to_ascii_lowercase(),
                length,
                written: 0,
            },
        );
        Ok(upload)
    }
    pub fn append(&mut self, upload: &str, offset: u64, bytes: &[u8]) -> Result<()> {
        let u = self
            .uploads
            .get_mut(upload)
            .ok_or_else(|| FileError::new("transfer", "保存任务已失效"))?;
        if bytes.len() > CHUNK || offset != u.written || bytes.len() as u64 > u.length - u.written {
            return Err(FileError::new("range", "保存分块的顺序或大小无效"));
        }
        u.temp.write_all(bytes)?;
        u.written += bytes.len() as u64;
        Ok(())
    }
    pub fn cancel(&mut self, upload: &str) {
        self.uploads.remove(upload);
    }
    pub fn finish(&mut self, upload: &str) -> Result<Written> {
        let mut u = self
            .uploads
            .remove(upload)
            .ok_or_else(|| FileError::new("transfer", "保存任务已失效"))?;
        if u.written != u.length {
            return Err(FileError::new("incomplete", "保存尚未完成，原文件未修改"));
        }
        u.temp.flush()?;
        u.temp.as_file().sync_all()?;
        if hash_file(u.temp.path())? != Some((u.hash.clone(), u.length)) {
            return Err(FileError::new("verify", "临时文件校验失败，原文件未修改"));
        }
        let g = self
            .grants
            .get_mut(&u.target)
            .ok_or_else(|| FileError::new("grant", "文件访问已失效"))?;
        let actual = current_hash(&g.path)?;
        if actual != u.expected {
            return Err(FileError::conflict(actual));
        }
        let mut backup_path = None;
        if let Some(ref expected) = u.expected {
            let mut backup = Builder::new()
                .prefix(".rocos-backup-")
                .tempfile_in(g.path.parent().unwrap())?;
            let mut original = File::open(checked_path(&g.path)?)?;
            std::io::copy(&mut original, &mut backup)?;
            backup.flush()?;
            backup.as_file().sync_all()?;
            if current_hash(backup.path())?.as_ref() != Some(expected) {
                return Err(FileError::conflict(current_hash(&g.path)?));
            }
            let extension = g.path.extension().and_then(|v| v.to_str()).unwrap_or("bak");
            let stem = g.path.file_stem().unwrap().to_string_lossy();
            let path = g
                .path
                .with_file_name(format!("{}-backup-{}.{}", stem, id(), extension));
            backup
                .persist_noclobber(&path)
                .map_err(|e| FileError::from(e.error))?;
            backup_path = Some(path.to_string_lossy().into_owned());
        }
        let actual = current_hash(&g.path)?;
        if actual != u.expected {
            return Err(FileError::conflict(actual));
        }
        // Each replacement is atomic on supported local filesystems. The hash
        // comparison is not a filesystem-wide lock against third-party writers.
        if u.expected.is_none() {
            u.temp
                .persist_noclobber(&g.path)
                .map_err(|e| FileError::from(e.error))?;
        } else {
            u.temp
                .persist(&g.path)
                .map_err(|e| FileError::from(e.error))?;
        }
        g.handle.size = u.length;
        g.handle.sha256 = Some(u.hash);
        #[cfg(unix)]
        let warning = File::open(g.path.parent().unwrap())
            .and_then(|f| f.sync_all())
            .err()
            .map(|e| format!("文件已替换，但目录同步失败：{}", e));
        #[cfg(not(unix))]
        let warning = None;
        Ok(Written {
            handle: g.handle.clone(),
            backup_path,
            warning,
        })
    }
    pub fn directory(&mut self, root: &Path) -> Result<Vec<Handle>> {
        if fs::symlink_metadata(root)?.file_type().is_symlink() {
            return Err(FileError::new("path", "不支持符号链接目录"));
        }
        let root = fs::canonicalize(root)?;
        let mut paths = Vec::new();
        let mut total = 0;
        fn walk(
            root: &Path,
            dir: &Path,
            paths: &mut Vec<(PathBuf, String)>,
            total: &mut u64,
            depth: usize,
        ) -> Result<()> {
            if depth > 64 {
                return Err(FileError::new("limit", "目录层级过深"));
            }
            for item in fs::read_dir(dir)? {
                let item = item?;
                let path = item.path();
                let meta = fs::symlink_metadata(&path)?;
                if meta.file_type().is_symlink() {
                    return Err(FileError::new(
                        "path",
                        format!("目录包含符号链接：{}", path.display()),
                    ));
                }
                if meta.is_dir() {
                    walk(root, &path, paths, total, depth + 1)?;
                } else if meta.is_file() {
                    if meta.len() > MAX_FILE
                        || *total + meta.len() > MAX_ARCHIVE
                        || paths.len() >= MAX_ENTRIES
                    {
                        return Err(FileError::new("limit", "导入目录超过资源限额"));
                    }
                    *total += meta.len();
                    let rel = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_str()
                        .ok_or_else(|| FileError::new("path", "路径不是 UTF-8"))?
                        .replace('\\', "/");
                    paths.push((path, rel));
                } else {
                    return Err(FileError::new(
                        "path",
                        format!("目录包含非普通文件：{}", path.display()),
                    ));
                }
            }
            Ok(())
        }
        walk(&root, &root, &mut paths, &mut total, 0)?;
        paths.sort_by(|a, b| a.1.cmp(&b.1));
        let mut handles = Vec::new();
        for (path, rel) in paths {
            match self.grant(&path, false, Some(rel)) {
                Ok(h) => handles.push(h),
                Err(e) => {
                    for h in &handles {
                        self.release(&h.token);
                    }
                    return Err(e);
                }
            }
        }
        Ok(handles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }
    fn save(service: &mut Files, h: &Handle, bytes: &[u8]) -> Result<Written> {
        let id = service.begin(&h.token, bytes.len() as u64, &hash(bytes))?;
        service.append(&id, 0, bytes)?;
        service.finish(&id)
    }
    #[test]
    fn save_existing_verifies_bytes_and_preserves_previous_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("工程.rcproj");
        fs::write(&path, b"old snapshot").unwrap();
        let mut s = Files::default();
        let h = s.grant(&path, true, None).unwrap();
        let written = save(&mut s, &h, b"new snapshot").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new snapshot");
        assert_eq!(written.handle.sha256, Some(hash(b"new snapshot")));
        assert_eq!(
            fs::read(written.backup_path.unwrap()).unwrap(),
            b"old snapshot"
        );
        let newer = save(&mut s, &h, b"third snapshot").unwrap();
        assert_eq!(newer.handle.sha256, Some(hash(b"third snapshot")));
    }
    #[test]
    fn external_edits_before_or_during_save_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.rcproj");
        fs::write(&path, b"baseline").unwrap();
        let mut s = Files::default();
        let h = s.grant(&path, true, None).unwrap();
        fs::write(&path, b"external").unwrap();
        assert_eq!(save(&mut s, &h, b"ours").unwrap_err().code, "conflict");
        assert_eq!(fs::read(&path).unwrap(), b"external");
        let h = s.grant(&path, true, None).unwrap();
        let id = s.begin(&h.token, 4, &hash(b"ours")).unwrap();
        s.append(&id, 0, b"ours").unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(s.finish(&id).unwrap_err().code, "conflict");
        assert!(!path.exists());
    }
    #[test]
    fn corrupt_incomplete_and_cancelled_writes_preserve_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.rcproj");
        fs::write(&path, b"original").unwrap();
        let mut s = Files::default();
        let h = s.grant(&path, true, None).unwrap();
        let id = s.begin(&h.token, 4, &hash(b"ours")).unwrap();
        s.append(&id, 0, b"oops").unwrap();
        assert_eq!(s.finish(&id).unwrap_err().code, "verify");
        let id = s.begin(&h.token, 4, &hash(b"ours")).unwrap();
        s.append(&id, 0, b"ou").unwrap();
        assert_eq!(s.finish(&id).unwrap_err().code, "incomplete");
        let id = s.begin(&h.token, 4, &hash(b"ours")).unwrap();
        s.append(&id, 0, b"ou").unwrap();
        s.cancel(&id);
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn new_file_writes_refuse_new_external_file_and_path_grants_are_enforced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.rcproj");
        let mut s = Files::default();
        assert!(s.read("invented-path", 0, 1).is_err());
        let h = s.grant(&path, true, None).unwrap();
        let id = s.begin(&h.token, 3, &hash(b"new")).unwrap();
        s.append(&id, 0, b"new").unwrap();
        fs::write(&path, b"other").unwrap();
        assert_eq!(s.finish(&id).unwrap_err().code, "conflict");
        let h = s.grant(&path, false, None).unwrap();
        assert_eq!(save(&mut s, &h, b"no").unwrap_err().code, "readonly");
        assert_eq!(fs::read(&path).unwrap(), b"other");
    }
    #[test]
    fn chunk_order_length_and_competing_writes_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p");
        let mut s = Files::default();
        let h = s.grant(&path, true, None).unwrap();
        let other = s.grant(&path, true, None).unwrap();
        let id = s.begin(&h.token, 4, &hash(b"ours")).unwrap();
        assert_eq!(
            s.begin(&other.token, 4, &hash(b"ours")).unwrap_err().code,
            "busy"
        );
        assert!(s.append(&id, 1, b"ours").is_err());
        assert!(s.append(&id, 0, b"longer").is_err());
        s.append(&id, 0, b"ou").unwrap();
        s.append(&id, 2, b"rs").unwrap();
        s.finish(&id).unwrap();
        assert_eq!(s.read(&h.token, 1, 2).unwrap(), b"ur");
        assert!(s.read(&h.token, 0, 5).is_err());
    }
    #[test]
    fn save_as_rejects_current_path_and_disk_preview_does_not_advance_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.rcproj");
        fs::write(&path, b"original").unwrap();
        let mut s = Files::default();
        let current = s.grant(&path, true, None).unwrap();
        let same = s.grant(&path, true, None).unwrap();
        assert_eq!(
            s.ensure_distinct(&same.token, &current.token)
                .unwrap_err()
                .code,
            "same-target"
        );
        let separate = s
            .grant(&dir.path().join("copy.rcproj"), true, None)
            .unwrap();
        s.ensure_distinct(&separate.token, &current.token).unwrap();
        fs::write(&path, b"external").unwrap();
        let preview = s.refresh(&current.token).unwrap();
        assert_eq!(s.read(&preview.token, 0, 8).unwrap(), b"external");
        assert_eq!(
            save(&mut s, &preview, b"ours").unwrap_err().code,
            "readonly"
        );
        assert_eq!(
            save(&mut s, &current, b"ours").unwrap_err().code,
            "conflict"
        );
        save(&mut s, &separate, b"ours").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"external");
    }
    #[test]
    fn directory_import_keeps_relative_paths_and_releases_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("模型")).unwrap();
        fs::write(dir.path().join("模型/arm.urdf"), b"model").unwrap();
        let mut s = Files::default();
        let files = s.directory(dir.path()).unwrap();
        assert_eq!(files[0].relative_path.as_deref(), Some("模型/arm.urdf"));
        assert_eq!(s.read(&files[0].token, 0, 5).unwrap(), b"model");
        s.release(&files[0].token);
        assert!(s.read(&files[0].token, 0, 5).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_are_rejected_before_overwrite_and_directory_import() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p");
        let outside = dir.path().join("outside");
        fs::write(&path, b"ours").unwrap();
        fs::write(&outside, b"untouched").unwrap();
        let mut s = Files::default();
        let h = s.grant(&path, true, None).unwrap();
        fs::remove_file(&path).unwrap();
        symlink(&outside, &path).unwrap();
        assert!(save(&mut s, &h, b"new").is_err());
        assert!(s.directory(dir.path()).is_err());
        assert_eq!(fs::read(outside).unwrap(), b"untouched");
    }
}
