use crate::*;
use parking_lot::RwLock;
use std::convert::TryFrom;
use std::mem::MaybeUninit;
use std::sync::{Arc, Mutex};
use wasi::*;

pub enum File {
    Dir(Dir),
    RegularFile(RegularFile),
}

impl File {
    pub fn filetype(&self) -> Filetype {
        if self.is_dir() {
            FILETYPE_DIRECTORY
        } else {
            FILETYPE_REGULAR_FILE
        }
    }

    pub fn size(&self) -> u64 {
        if let Ok(file) = self.as_regular_file() {
            file.size()
        } else {
            0
        }
    }

    #[allow(dead_code)]
    pub fn is_regular_file(&self) -> bool {
        matches!(self, Self::RegularFile(_))
    }

    pub fn is_dir(&self) -> bool {
        matches!(self, Self::Dir(_))
    }

    pub fn as_regular_file(&self) -> Result<&RegularFile> {
        match self {
            Self::RegularFile(file) => Ok(file),
            _ => Err(ERRNO_BADF),
        }
    }

    pub fn as_regular_file_mut(&mut self) -> Result<&mut RegularFile> {
        match self {
            Self::RegularFile(file) => Ok(file),
            _ => Err(ERRNO_BADF),
        }
    }

    pub fn as_dir(&self) -> Result<&Dir> {
        match self {
            Self::Dir(file) => Ok(file),
            _ => Err(ERRNO_BADF),
        }
    }
}

pub enum RegularFile {
    URL {
        url: String,
        len: Mutex<Option<u64>>,
    },
    Buf(Vec<u8>),
}

impl Drop for RegularFile {
    fn drop(&mut self) {
        self.free_url();
    }
}

impl RegularFile {
    fn as_buf(&self) -> Option<&Vec<u8>> {
        match self {
            Self::Buf(buf) => Some(buf),
            _ => None,
        }
    }

    fn as_buf_mut(&mut self) -> Option<&mut Vec<u8>> {
        match self {
            Self::Buf(buf) => Some(buf),
            _ => None,
        }
    }

    fn free_url(&self) {
        match self {
            Self::URL { url, .. } => {
                unsafe { url_free(url.as_ptr(), url.len()) };
            }
            _ => {}
        }

        extern "C" {
            fn url_free(url_ptr: *const u8, url_len: usize);
        }
    }

    pub fn read(&self, pos: u64) -> Result<u64> {
        let mut nread = MaybeUninit::uninit();
        let ok = match self {
            Self::URL { url, .. } => unsafe {
                url_read(url.as_ptr(), url.len(), pos, nread.as_mut_ptr())
            },
            Self::Buf(buf) => unsafe { read(buf.as_ptr(), buf.len(), pos, nread.as_mut_ptr()) },
        };

        if ok == 0 {
            let nread = unsafe { nread.assume_init() };
            return Ok(nread);
        } else {
            return Err(ERRNO_IO);
        }

        extern "C" {
            fn url_read(url_ptr: *const u8, url_len: usize, pos: u64, nread_ptr: *mut u64) -> u32;

            fn read(ptr: *const u8, len: usize, pos: u64, nread_ptr: *mut u64) -> u32;
        }
    }

    pub fn write(&mut self, len: u64, pos: u64) -> Result<u64> {
        self.to_buf()?;

        if let Some((len, pos)) = usize::try_from(len).ok().zip(usize::try_from(pos).ok()) {
            if len > self.as_buf().unwrap().len() - pos {
                self.allocate(len as u64, pos as u64)?;
            }
            let buf = self.as_buf_mut().unwrap();
            unsafe { write(buf.as_mut_ptr().add(pos)) };
            return Ok(len as u64);
        } else {
            return Err(ERRNO_NOMEM);
        }

        extern "C" {
            fn write(ptr: *mut u8);
        }
    }

    pub fn size(&self) -> u64 {
        match self {
            Self::URL { url, len } => {
                let mut len_opt = len.lock().unwrap();
                if let Some(len) = len_opt.as_ref() {
                    return *len;
                } else {
                    // TODO: handle error
                    let len = unsafe { url_len(url.as_ptr(), url.len()) };
                    *len_opt = Some(len);
                    return len;
                }
            }
            Self::Buf(buf) => {
                return buf.len() as u64;
            }
        }

        extern "C" {
            fn url_len(url_ptr: *const u8, url_len: usize) -> u64;
        }
    }

    pub fn truncate(&mut self, size: u64) -> Result<()> {
        self.to_buf()?;

        if let Ok(size) = usize::try_from(size) {
            let buf_len = self.as_buf().unwrap().len();
            if size == 0 {
                *self.as_buf_mut().unwrap() = Vec::new();
            } else if size > buf_len {
                self.allocate(0, size as u64)?;
            } else if size != buf_len {
                self.as_buf_mut().unwrap().truncate(size);
            }
            Ok(())
        } else {
            Err(ERRNO_NOMEM)
        }
    }

    pub fn allocate(&mut self, offset: u64, len: u64) -> Result<()> {
        self.to_buf()?;

        if let Ok(cap) = usize::try_from(offset + len) {
            let buf = self.as_buf_mut().unwrap();
            buf.reserve(cap);
            buf.resize(cap, 0);
            Ok(())
        } else {
            Err(ERRNO_NOMEM)
        }
    }

    fn to_buf(&mut self) -> Result<()> {
        let buf = match self {
            Self::URL { url, .. } => {
                let mut len = MaybeUninit::uninit();
                let ptr = unsafe { url_buf(url.as_ptr(), url.len(), len.as_mut_ptr()) };
                if ptr.is_null() {
                    return Err(ERRNO_IO);
                }
                // If the allocation succeeds then this cast is valid.
                let len = unsafe { len.assume_init() as usize };
                self.free_url();
                Some(read_bytes(ptr, len))
            }
            Self::Buf(_) => None,
        };
        if let Some(buf) = buf {
            *self = Self::Buf(buf);
        }
        return Ok(());

        extern "C" {
            fn url_buf(url_ptr: *const u8, url_len: usize, len_ptr: *mut u64) -> *mut u8;
        }
    }
}

pub struct Dir {
    entries: DirEntriesKey,
    is_preopen: bool,
}

impl Dir {
    pub fn new<'a>(entries: DirEntriesKey, is_preopen: bool) -> Self {
        Self {
            entries,
            is_preopen,
        }
    }

    pub fn mount<'a>(
        &self,
        is_node: bool,
        src: &str,
        path: &str,
        ents: &mut DirEntries,
    ) -> Result<()> {
        if src.starts_with("http:")
            || src.starts_with("https:")
            || src.starts_with("file:")
            || src.starts_with("blob:")
            || (!src.is_empty() && !is_node)
        {
            self.write_file(path, 0, Some(src), ents)?;
        } else {
            if path != "." {
                self.mkdir(path, ents)?;
            }

            if src.is_empty() {
                return Ok(());
            }

            let mut len = MaybeUninit::uninit();
            let ptr = unsafe { node_readdir(src.as_ptr(), src.len(), len.as_mut_ptr()) };
            if ptr.is_null() {
                return Err(ERRNO_IO);
            }
            let len = unsafe { len.assume_init() };
            let s = read_string(ptr, len);

            if s.len() != 1 {
                let mut iter = s.split("\n");
                loop {
                    let src = iter.next();
                    if src.is_none() {
                        break;
                    }
                    let src = src.unwrap();
                    let name = iter.next().unwrap();

                    self.mount(is_node, src, &format!("{path}/{name}"), ents)?;
                }
            }
        }
        return Ok(());

        extern "C" {
            fn node_readdir(path_ptr: *const u8, path_len: usize, len_ptr: *mut usize) -> *mut u8;
        }
    }

    pub fn lookup<'a>(&self, path: &str, ents: &'a DirEntries) -> Result<&'a DirEntry> {
        let path = self.resolve_path(path)?;
        if path.is_empty() {
            // TODO: this assumes `self` is the root dir.
            Ok(&ROOT_DIR_ENTRY)
        } else {
            let ResolvedEntry { entry, .. } = self.resolve_entry(&path, ents);
            if let Some(entry) = entry {
                Ok(entry)
            } else {
                Err(ERRNO_NOENT)
            }
        }
    }

    pub fn mkdir(&self, path: &str, ents: &mut DirEntries) -> Result<()> {
        let path = self.resolve_path(path)?;
        let ResolvedEntry {
            parent,
            entry,
            name,
        } = self.resolve_entry(&path, ents);

        if entry.is_some() || path.is_empty() {
            return Err(ERRNO_EXIST);
        }
        if parent.is_none() {
            return Err(ERRNO_NOENT);
        }

        let entries = next_dir_entries_key();
        let file = Arc::new(RwLock::new(File::Dir(Dir {
            entries,
            is_preopen: false,
        })));
        ents.get_mut(&parent.unwrap()).unwrap().push(DirEntry {
            name: name.unwrap().into(),
            file,
            filetype: FILETYPE_DIRECTORY,
            entries: Some(entries),
            cookie: next_dir_entry_cookie(),
        });
        ents.insert(entries, Vec::new());

        Ok(())
    }

    pub fn read_file(&self, path: &str, ents: &DirEntries) -> Result<()> {
        let ent = self.lookup(path, ents)?;
        let file_r = ent.file.read();
        let file = file_r.as_regular_file()?;
        unsafe { set_buf(file.size()) };
        file.read(0)?;
        return Ok(());

        extern "C" {
            fn set_buf(size: u64);
        }
    }

    pub fn write_file(
        &self,
        path: &str,
        buf_len: usize,
        url: Option<&str>,
        ents: &mut DirEntries,
    ) -> Result<()> {
        let path = self.resolve_path(path)?;

        let file = if let Some(url) = url {
            RegularFile::URL {
                url: url.into(),
                len: Mutex::new(None),
            }
        } else {
            let mut buf = vec![0; buf_len];
            unsafe { write(buf.as_mut_ptr()) };
            RegularFile::Buf(buf)
        };
        let ResolvedEntry {
            entry,
            parent,
            name,
        } = self.resolve_entry(&path, ents);
        if let Some(entry) = entry {
            *entry.file.write() = File::RegularFile(file);
        } else {
            if parent.is_none() {
                return Err(ERRNO_NOENT);
            }
            drop(entry);
            ents.get_mut(&parent.unwrap()).unwrap().push(DirEntry {
                name: name.unwrap().into(),
                filetype: FILETYPE_REGULAR_FILE,
                entries: None,
                file: Arc::new(RwLock::new(File::RegularFile(file))),
                cookie: next_dir_entry_cookie(),
            });
        }

        return Ok(());

        extern "C" {
            fn write(ptr: *mut u8);
        }
    }

    pub fn rename(&self, old_path: &str, new_path: &str, ents: &mut DirEntries) -> Result<()> {
        let from_path = self.resolve_path(old_path)?;
        let to_path = self.resolve_path(new_path)?;

        let ent = self.resolve_entry(&from_path, ents);
        if ent.entry.is_none() {
            return Err(ERRNO_BADF);
        }
        if ent.parent.is_none() {
            return Err(ERRNO_NOTCAPABLE);
        }

        let to_ent = self.resolve_entry(&to_path, ents);
        if to_ent.parent.is_none() {
            return Err(ERRNO_NOTCAPABLE);
        }
        let to_name = to_ent.name.unwrap().to_string();
        drop(to_ent);

        let ents_key = ent.parent.unwrap();
        let from_name = ent.name.unwrap().to_string();
        drop(ent);

        let mut ent = ents
            .get_mut(&ents_key)
            .unwrap()
            .drain_filter(|x| x.name == from_name)
            .next()
            .unwrap();
        ent.cookie = next_dir_entry_cookie();
        ent.name = to_name;

        let to_ents_key = self.resolve_entry(&to_path, ents).parent.unwrap();
        ents.get_mut(&to_ents_key).unwrap().push(ent);

        Ok(())
    }

    pub fn unlink(&self, path: &str, ents: &mut DirEntries) -> Result<()> {
        let path = self.resolve_path(path)?;
        let ResolvedEntry {
            parent,
            entry,
            name,
        } = self.resolve_entry(&path, ents);

        if entry.is_none() {
            return Err(ERRNO_NOENT);
        }
        if entry.unwrap().is_dir() {
            return Err(ERRNO_ISDIR);
        }
        ents.get_mut(&parent.unwrap())
            .unwrap()
            .drain_filter(|ent| &ent.name == name.unwrap());

        Ok(())
    }

    pub fn rmdir(&self, path: &str, recursive: bool, ents: &mut DirEntries) -> Result<()> {
        let path = self.resolve_path(path)?;

        let (parent_entries, entries, name) = {
            let ResolvedEntry {
                parent,
                entry,
                name,
            } = self.resolve_entry(&path, ents);
            if entry.is_none() {
                return Err(ERRNO_NOENT);
            }
            if !entry.unwrap().is_dir() {
                return Err(ERRNO_NOTDIR);
            }
            let dir_r = entry.unwrap().file.read();
            let dir = dir_r.as_dir().unwrap();
            if !ents[&dir.entries].is_empty() && !recursive {
                return Err(ERRNO_NOTEMPTY);
            }
            if dir.is_preopen {
                return Err(ERRNO_NOTCAPABLE);
            }
            (parent.unwrap(), dir.entries, name.unwrap().to_string())
        };
        ents.get_mut(&parent_entries)
            .unwrap()
            .drain_filter(|ent| ent.name == name);
        rmdir_recursive(entries, ents);

        return Ok(());

        fn rmdir_recursive(entries: DirEntriesKey, ents: &mut DirEntries) {
            if let Some(dirents) = ents.remove(&entries) {
                for ent in dirents.iter() {
                    if let Some(entries) = ent.entries {
                        rmdir_recursive(entries, ents);
                    }
                }
            }
        }
    }

    pub fn entries<'a>(&self, ents: &'a DirEntries) -> &'a [DirEntry] {
        &ents[&self.entries]
    }

    pub fn open(
        &self,
        path: &str,
        oflags: Oflags,
        ents: &mut DirEntries,
    ) -> Result<Option<Arc<RwLock<File>>>> {
        let path = self.resolve_path(path)?;

        if (oflags & OFLAGS_DIRECTORY) != 0 {
            if path.is_empty() {
                return Ok(None);
            }
            let ResolvedEntry { entry, .. } = self.resolve_entry(&path, ents);
            if entry.is_none() {
                return Err(ERRNO_NOENT);
            }
            if entry.unwrap().is_regular_file() {
                return Err(ERRNO_NOTDIR);
            }
            Ok(Some(entry.unwrap().file.clone()))
        } else {
            let ResolvedEntry {
                mut entry,
                parent,
                name,
            } = self.resolve_entry(&path, ents);
            if parent.is_none() {
                return Err(ERRNO_NOENT);
            }
            if path.is_empty() || entry.map(|ent| ent.is_dir()).unwrap_or(false) {
                return Err(ERRNO_ISDIR);
            }
            if entry.is_some() && (oflags & OFLAGS_CREAT) != 0 && (oflags & OFLAGS_EXCL) != 0 {
                return Err(ERRNO_EXIST);
            }
            if entry.is_none() {
                if (oflags & OFLAGS_CREAT) == 0 {
                    return Err(ERRNO_NOENT);
                }
                let key = parent.unwrap();
                ents.get_mut(&key).unwrap().push(DirEntry {
                    name: name.unwrap().into(),
                    filetype: FILETYPE_REGULAR_FILE,
                    entries: None,
                    file: Arc::new(RwLock::new(File::RegularFile(RegularFile::Buf(Vec::new())))),
                    cookie: next_dir_entry_cookie(),
                });
                entry = ents[&key].iter().find(|ent| &ent.name == name.unwrap());
            }
            if (oflags & OFLAGS_TRUNC) != 0 {
                entry
                    .unwrap()
                    .file
                    .write()
                    .as_regular_file_mut()
                    .unwrap()
                    .truncate(0)
                    .unwrap();
            }
            Ok(Some(entry.unwrap().file.clone()))
        }
    }

    fn resolve_path(&self, mut path: &str) -> Result<String> {
        // Hack to get Emscripten absolute/relative paths to "work".
        while path.starts_with("~/~/") {
            path = &path[4..];
        }
        let current_dir = CURRENT_DIR.read();
        let iter = if !path.starts_with("~") {
            current_dir.as_str()
        } else {
            ""
        }
        .split("/")
        .chain(path.split("/"));
        let mut resolved_parts = Vec::new();
        for item in iter {
            if item == ".." {
                if resolved_parts.pop().is_none() {
                    return Err(ERRNO_NOTCAPABLE);
                }
            } else if !item.is_empty() && item != "." && item != "~" {
                resolved_parts.push(item);
            }
        }
        Ok(resolved_parts.join("/"))
    }

    fn resolve_entry<'a, 'b>(&self, path: &'b str, ents: &'a DirEntries) -> ResolvedEntry<'a, 'b> {
        let mut ret: ResolvedEntry = Default::default();
        if !path.contains('/') {
            ret.parent = Some(self.entries);
        }
        let mut entry: Option<&DirEntry> = None;
        let comps = path.split("/").collect::<Vec<_>>();
        for (pos, comp) in comps.iter().enumerate() {
            if entry.is_none() {
                entry = ents[&self.entries].iter().find(|ent| &ent.name == comp);
            } else if entry.unwrap().is_dir() {
                let entries = entry.unwrap().entries.unwrap();
                entry = ents[&entries].iter().find(|ent| &ent.name == comp);
            }
            if Some(pos) == comps.len().checked_sub(2) {
                if let Some(entries) = entry.and_then(|ent| ent.entries) {
                    ret.parent = Some(entries);
                }
            } else if Some(pos) == comps.len().checked_sub(1) {
                ret.entry = entry;
                ret.name = Some(comp);
            }
            if entry.is_none() {
                break;
            }
        }
        ret
    }
}

pub struct DirEntry {
    pub name: String,
    pub file: Arc<RwLock<File>>,
    pub filetype: Filetype,
    pub entries: Option<DirEntriesKey>,
    pub cookie: u64,
}

impl DirEntry {
    pub fn is_dir(&self) -> bool {
        matches!(self.filetype, FILETYPE_DIRECTORY)
    }

    pub fn is_regular_file(&self) -> bool {
        matches!(self.filetype, FILETYPE_REGULAR_FILE)
    }
}

#[derive(Default)]
struct ResolvedEntry<'a, 'b> {
    parent: Option<DirEntriesKey>,
    entry: Option<&'a DirEntry>,
    name: Option<&'b str>,
}
