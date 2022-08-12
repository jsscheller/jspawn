use crate::*;
use parking_lot::RwLock;
use std::sync::Arc;
use wasi::*;

pub struct FileDesc {
    pub file: Arc<RwLock<File>>,
    pub pos: u64,
    pub preopen: Option<String>,
}

impl FileDesc {
    pub fn new(file: Arc<RwLock<File>>, pos: u64, preopen: Option<String>) -> Self {
        Self { file, pos, preopen }
    }

    pub fn seek(&mut self, offset: u64, whence: Whence) -> Result<u64> {
        let size = self.file.read().as_regular_file()?.size();
        let base_pos = match whence {
            WHENCE_SET => 0u64,
            WHENCE_CUR => self.pos,
            WHENCE_END => size,
            _ => unreachable!(),
        };
        self.pos = base_pos + offset;
        Ok(self.pos)
    }
}
