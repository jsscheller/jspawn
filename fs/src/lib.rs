#![feature(drain_filter)]
#![feature(once_cell)]

mod fd_table;
mod file;
mod file_desc;

pub use fd_table::*;
pub use file::*;
pub use file_desc::*;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::convert::TryInto;
use std::lazy::SyncLazy;
use std::sync::Arc;
use wasi::*;

type DirEntriesKey = u32;
type DirEntries = HashMap<DirEntriesKey, Vec<DirEntry>>;
type Result<T> = std::result::Result<T, Errno>;

static DIR_ENTRIES: SyncLazy<RwLock<HashMap<DirEntriesKey, Vec<DirEntry>>>> = SyncLazy::new(|| {
    let mut map = HashMap::new();
    // Root dir
    map.insert(0, Vec::new());
    RwLock::new(map)
});
static NEXT_DIR_ENTRIES_KEY: RwLock<DirEntriesKey> = RwLock::new(1);
static NEXT_DIR_ENTRY_COOKIE: RwLock<u64> = RwLock::new(0);
static NEXT_FD: RwLock<Fd> = RwLock::new(0);
static ROOT_DIR: SyncLazy<Arc<RwLock<File>>> =
    SyncLazy::new(|| Arc::new(RwLock::new(File::Dir(Dir::new(0, true)))));
static ROOT_DIR_ENTRY: SyncLazy<DirEntry> = SyncLazy::new(|| DirEntry {
    name: "".into(),
    file: ROOT_DIR.clone(),
    filetype: FILETYPE_DIRECTORY,
    entries: Some(0),
    cookie: 0,
});
static FD_TABLE: SyncLazy<RwLock<FDTable>> = SyncLazy::new(|| RwLock::new(FDTable::init()));
static CURRENT_DIR: RwLock<String> = RwLock::new(String::new());

fn next_fd() -> Fd {
    let mut lock = NEXT_FD.write();
    let next = *lock;
    *lock += 1;
    next
}

fn next_dir_entry_cookie() -> u64 {
    let mut lock = NEXT_DIR_ENTRY_COOKIE.write();
    let next = *lock;
    *lock += 1;
    next
}

fn next_dir_entries_key() -> DirEntriesKey {
    let mut lock = NEXT_DIR_ENTRIES_KEY.write();
    let next = *lock;
    *lock += 1;
    next
}

enum Arg {
    Null,
    String(String),
    U32(u32),
    U64(u64),
    Bool(bool),
}

impl Arg {
    fn as_u32(&self) -> u32 {
        match self {
            Self::U32(x) => *x,
            _ => unreachable!(),
        }
    }

    fn as_u64(&self) -> u64 {
        match self {
            Self::U64(x) => *x,
            _ => unreachable!(),
        }
    }

    fn as_str(&self) -> &str {
        match self {
            Self::String(x) => x,
            _ => unreachable!(),
        }
    }

    fn as_bool(&self) -> bool {
        match self {
            Self::Bool(x) => *x,
            _ => unreachable!(),
        }
    }

    fn as_usize(&self) -> usize {
        match self {
            Self::U32(x) => *x as usize,
            _ => unreachable!(),
        }
    }

    fn as_opt_u64(&self) -> Option<u64> {
        match self {
            Self::U64(x) => Some(*x),
            Self::Null => None,
            _ => unreachable!(),
        }
    }

    fn as_opt_str(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s),
            Self::Null => None,
            _ => unreachable!(),
        }
    }
}

fn read_args(ptr: *mut u8, count: usize) -> Vec<Arg> {
    let usize_size = std::mem::size_of::<usize>();
    let size = 1 + usize_size * 2;
    let len = count * size;
    let buf = read_bytes(ptr, len);
    let mut args = Vec::new();
    for i in 0..count {
        let slice = &buf[i * size..];
        let arg = match slice[0] {
            0 => Arg::Null,
            1 => {
                let ptr =
                    usize::from_le_bytes(slice[1..1 + usize_size].try_into().unwrap()) as *mut u8;
                let len = usize::from_le_bytes(
                    slice[1 + usize_size..1 + usize_size * 2]
                        .try_into()
                        .unwrap(),
                );
                Arg::String(read_string(ptr, len))
            }
            2 => {
                let n = u32::from_le_bytes(slice[1..5].try_into().unwrap());
                Arg::U32(n)
            }
            3 => {
                let n = u64::from_le_bytes(slice[1..9].try_into().unwrap());
                Arg::U64(n)
            }
            4 => {
                let b = slice[1] != 0;
                Arg::Bool(b)
            }
            _ => unreachable!(),
        };
        args.push(arg);
    }
    args
}

fn read_bytes(ptr: *mut u8, len: usize) -> Vec<u8> {
    unsafe { Vec::from_raw_parts(ptr, len, len) }
}

fn read_string(ptr: *mut u8, len: usize) -> String {
    let bytes = read_bytes(ptr, len);
    unsafe { String::from_utf8_unchecked(bytes) }
}

#[allow(dead_code)]
#[derive(Debug)]
#[repr(u32)]
enum Request {
    ReadSync,
    WriteSync,
    FstatSync,
    OpenSync,
    CloseSync,
    ReaddirSync,
    RmdirSync,
    RenameSync,
    MkdirSync,
    ReadFile,
    FallocateSync,
    FtruncateSync,
    PrestatDirNameSync,
    RenumberSync,
    SeekSync,
    FreaddirSync,
    UnlinkSync,
    WriteFileSync,
    TruncateSync,
    LstatSync,
    Mount,
    Chdir,
}

#[no_mangle]
extern "C" fn request(req: Request, args_ptr: *mut u8, args_len: usize) -> Errno {
    let args = read_args(args_ptr, args_len);
    return match request_impl(req, args) {
        Err(errno) => errno,
        Ok(_) => ERRNO_SUCCESS,
    };

    fn request_impl(req: Request, args: Vec<Arg>) -> Result<()> {
        match req {
            Request::ReadSync => {
                let fd = args[0].as_u32();
                let pos = args[1].as_opt_u64();

                let fd_table = FD_TABLE.read();

                let mut desc = fd_table.get(fd)?.write();
                let nread = desc
                    .file
                    .read()
                    .as_regular_file()?
                    .read(pos.unwrap_or(desc.pos))?;
                if pos.is_none() {
                    desc.pos += nread;
                }
                out(format!("{nread}"));
            }
            Request::WriteSync => {
                let fd = args[0].as_u32();
                let len = args[1].as_u64();
                let pos = args[2].as_opt_u64();

                let fd_table = FD_TABLE.read();

                let mut desc = fd_table.get(fd)?.write();
                let nwritten = desc
                    .file
                    .write()
                    .as_regular_file_mut()?
                    .write(len, pos.unwrap_or(desc.pos))?;
                if pos.is_none() {
                    desc.pos += nwritten;
                }
                out(format!("{nwritten}"));
            }
            Request::FstatSync => {
                let fd = args[0].as_u32();

                let fd_table = FD_TABLE.read();

                let desc = fd_table.get(fd)?.read();
                out(ser_stats(&desc.file.read()));
            }
            Request::OpenSync => {
                let path = args[0].as_str();
                let oflags = args[1].as_u32() as Oflags;
                let fdflags = args[2].as_u32() as Fdflags;

                let mut ents = DIR_ENTRIES.write();
                let mut fd_table = FD_TABLE.write();
                let root_dir = ROOT_DIR.read();

                let file = root_dir
                    .as_dir()
                    .unwrap()
                    .open(path, oflags, &mut ents)?
                    .unwrap_or_else(|| ROOT_DIR.clone());
                let fd = fd_table.open(file, fdflags);
                out(format!("{fd}"));
            }
            Request::CloseSync => {
                let fd = args[0].as_u32();

                let mut fd_table = FD_TABLE.write();

                fd_table.close(fd)?;
            }
            Request::ReaddirSync => {
                let path = args[0].as_str();
                let with_file_types = args[1].as_bool();

                let ents = DIR_ENTRIES.read();
                let root_dir = ROOT_DIR.read();

                let file = root_dir.as_dir().unwrap().lookup(path, &ents)?.file.read();
                let dirents = file.as_dir()?.entries(&ents);
                out(ser_dirents(dirents, with_file_types, None));
            }
            Request::RmdirSync => {
                let path = args[0].as_str();
                let recursive = args[1].as_bool();

                let mut ents = DIR_ENTRIES.write();
                let root_dir = ROOT_DIR.read();

                root_dir
                    .as_dir()
                    .unwrap()
                    .rmdir(path, recursive, &mut ents)?;
            }
            Request::UnlinkSync => {
                let path = args[0].as_str();

                let mut ents = DIR_ENTRIES.write();
                let root_dir = ROOT_DIR.read();

                root_dir.as_dir().unwrap().unlink(path, &mut ents)?;
            }
            Request::RenameSync => {
                let old_path = args[0].as_str();
                let new_path = args[1].as_str();

                let mut ents = DIR_ENTRIES.write();
                let root_dir = ROOT_DIR.read();

                root_dir
                    .as_dir()
                    .unwrap()
                    .rename(old_path, new_path, &mut ents)?;
            }
            Request::WriteFileSync => {
                let path = args[0].as_str();
                let buf_len = args[1].as_usize();
                let url = args[2].as_opt_str();

                let mut ents = DIR_ENTRIES.write();
                let root_dir = ROOT_DIR.read();

                root_dir
                    .as_dir()
                    .unwrap()
                    .write_file(path, buf_len, url, &mut ents)?;
            }
            Request::MkdirSync => {
                let path = args[0].as_str();

                let mut ents = DIR_ENTRIES.write();
                let root_dir = ROOT_DIR.read();

                root_dir.as_dir().unwrap().mkdir(path, &mut ents)?;
            }
            Request::TruncateSync => {
                let path = args[0].as_str();
                let size = args[1].as_u64();

                let ents = DIR_ENTRIES.read();
                let root_dir = ROOT_DIR.read();

                root_dir
                    .as_dir()
                    .unwrap()
                    .lookup(path, &ents)?
                    .file
                    .write()
                    .as_regular_file_mut()?
                    .truncate(size)?;
            }
            Request::LstatSync => {
                let path = args[0].as_str();

                let ents = DIR_ENTRIES.read();
                let root_dir = ROOT_DIR.read();

                let ent = root_dir.as_dir().unwrap().lookup(path, &ents)?;
                out(ser_stats(&ent.file.read()));
            }
            Request::ReadFile => {
                let path = args[0].as_str();

                let ents = DIR_ENTRIES.read();
                let root_dir = ROOT_DIR.read();

                root_dir.as_dir().unwrap().read_file(path, &ents)?;
            }
            Request::FallocateSync => {
                let fd = args[0].as_u32();
                let offset = args[1].as_u64();
                let size = args[2].as_u64();

                let fd_table = FD_TABLE.read();

                let desc = fd_table.get(fd)?.read();
                desc.file
                    .write()
                    .as_regular_file_mut()?
                    .allocate(offset, size)?;
            }
            Request::FtruncateSync => {
                let fd = args[0].as_u32();
                let size = args[1].as_u64();

                let fd_table = FD_TABLE.read();

                let desc = fd_table.get(fd)?.read();
                desc.file.write().as_regular_file_mut()?.truncate(size)?;
            }
            Request::PrestatDirNameSync => {
                let fd = args[0].as_u32();

                let fd_table = FD_TABLE.read();

                let desc = fd_table.get(fd)?.read();
                if let Some(preopen) = desc.preopen.as_ref() {
                    out(format!("{:?}", preopen));
                } else {
                    return Err(ERRNO_BADF);
                }
            }
            Request::RenumberSync => {
                let from = args[0].as_u32();
                let to = args[1].as_u32();

                let mut fd_table = FD_TABLE.write();

                fd_table.renumber(from, to)?;
            }
            Request::SeekSync => {
                let fd = args[0].as_u32();
                let offset = args[1].as_u64();
                let whence = match args[2].as_u32() {
                    0 => WHENCE_SET,
                    1 => WHENCE_CUR,
                    2 => WHENCE_END,
                    _ => return Err(ERRNO_INVAL),
                };

                let fd_table = FD_TABLE.read();

                let new_offset = fd_table.get(fd)?.write().seek(offset, whence)?;
                out(format!("{new_offset}"));
            }
            Request::FreaddirSync => {
                let fd = args[0].as_u32();
                let cookie = args[1].as_u64();

                let fd_table = FD_TABLE.read();
                let ents = DIR_ENTRIES.read();

                let desc = fd_table.get(fd)?.read();
                let file = desc.file.read();
                let dirents = file.as_dir()?.entries(&ents);
                out(ser_dirents(dirents, true, Some(cookie)));
            }
            Request::Mount => {
                let is_node = args[0].as_bool();
                let s = args[1].as_str();

                let mut ents = DIR_ENTRIES.write();
                let root_dir = ROOT_DIR.read();

                let mut iter = s.split("\n");
                loop {
                    let src = iter.next();
                    if src.is_none() {
                        break;
                    }
                    let src = src.unwrap();
                    let path = iter.next().unwrap();

                    root_dir
                        .as_dir()
                        .unwrap()
                        .mount(is_node, src, path, &mut ents)?;
                }
            }
            Request::Chdir => {
                let dir = args[0].as_str();

                *CURRENT_DIR.write() = dir.into();
            }
        }
        Ok(())
    }
}

fn ser_stats(file: &File) -> String {
    let size = file.size();
    let filetype = file.filetype().raw();
    format!(r#"{{"size":{size},"filetype":{filetype}}}"#)
}

fn ser_dirents(dirents: &[DirEntry], with_file_types: bool, cookie: Option<u64>) -> String {
    let mut ser = Vec::new();
    for ent in dirents {
        if cookie.map(|cookie| cookie < ent.cookie).unwrap_or(false) {
            continue;
        }
        if with_file_types {
            ser.push(format!(
                r#"{{"name":{:?},"type":{},"cookie":{}}}"#,
                ent.name,
                ent.filetype.raw(),
                ent.cookie
            ));
        } else {
            ser.push(format!("{:?}", ent.name));
        }
    }
    format!("[{}]", ser.join(","))
}

#[allow(dead_code)]
fn println(s: String) {
    unsafe { println(s.as_ptr(), s.len()) };

    extern "C" {
        fn println(ptr: *const u8, len: usize);
    }
}

fn out(s: String) {
    unsafe { out(s.as_ptr(), s.len()) };

    extern "C" {
        fn out(ptr: *const u8, len: usize);
    }
}

#[no_mangle]
extern "C" fn alloc(len: usize) -> *mut u8 {
    assert!(len != 0);
    unsafe {
        let layout = std::alloc::Layout::from_size_align(len, std::mem::align_of::<u8>()).unwrap();
        let ptr = std::alloc::alloc(layout);
        ptr as *mut u8
    }
}
