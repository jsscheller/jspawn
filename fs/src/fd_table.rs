use crate::*;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use wasi::*;

#[derive(Default)]
pub struct FDTable {
    map: HashMap<Fd, Arc<RwLock<FileDesc>>>,
}

impl FDTable {
    pub fn init() -> Self {
        let mut this = Self::default();
        for _ in 0..3 {
            let file = Arc::new(RwLock::new(File::RegularFile(RegularFile::Buf(Vec::new()))));
            this.open(file, 0);
        }
        this.preopen(ROOT_DIR.clone(), "/".into());
        this
    }

    pub fn get(&self, fd: Fd) -> Result<&Arc<RwLock<FileDesc>>> {
        if let Some(desc) = self.map.get(&fd) {
            Ok(desc)
        } else {
            Err(ERRNO_BADF)
        }
    }

    pub fn preopen(&mut self, file: Arc<RwLock<File>>, preopen: String) -> Fd {
        let fd = next_fd();
        self.map.insert(
            fd,
            Arc::new(RwLock::new(FileDesc::new(file, 0, Some(preopen)))),
        );
        fd
    }

    pub fn open(&mut self, file: Arc<RwLock<File>>, flags: Fdflags) -> Fd {
        let fd = next_fd();
        let pos = if (flags & FDFLAGS_APPEND) != 0 {
            file.read().size()
        } else {
            0
        };
        self.map
            .insert(fd, Arc::new(RwLock::new(FileDesc::new(file, pos, None))));
        fd
    }

    pub fn close(&mut self, fd: Fd) -> Result<()> {
        if self.map.remove(&fd).is_none() {
            Err(ERRNO_BADF)
        } else {
            Ok(())
        }
    }

    pub fn renumber(&mut self, from: Fd, to: Fd) -> Result<()> {
        let from_desc = self.get(from)?.clone();
        let to_desc = self.get(to)?.clone();
        if from_desc.read().preopen.is_some() || to_desc.read().preopen.is_some() {
            return Err(ERRNO_BADF);
        }
        self.map.insert(from, to_desc);
        self.map.insert(to, from_desc);
        Ok(())
    }
}
