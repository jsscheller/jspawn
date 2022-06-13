import { Context } from "./context";
import * as wasi from "./wasi/index";
import { IOVecs } from "./ioVecs";

// Mimic node's `constants` module.
export const constants = {
  ["O_APPEND"]: 1024,
  ["O_CREAT"]: 64,
  ["O_EXCL"]: 128,
  ["O_NOCTTY"]: 256,
  ["O_RDONLY"]: 0,
  ["O_RDWR"]: 2,
  ["O_SYNC"]: 4096,
  ["O_TRUNC"]: 512,
  ["O_WRONLY"]: 1,
  ["O_DIRECTORY"]: 65536,
  ["S_IFREG"]: 32768,
  ["S_IFDIR"]: 16384,
  ["S_IFLNK"]: 40960,
};

export function readFileToBlobSync(ctx: Context, path: string): Blob {
  return ctx.rootDir.lookup(path).asRegularFile().readToBlob();
}

// The following are used by `nodeShim`.

export function readSync(
  ctx: Context,
  fd: number,
  buffer: ArrayBuffer,
  offset: number = 0,
  length?: number,
  position?: number | bigint
): number {
  length = length == null ? buffer.byteLength : length;
  const iovs = new IOVecs(new Uint8Array(buffer, offset, length));
  return ctx.fdTable.get(fd).read(iovs, position);
}

export function writeSync(
  ctx: Context,
  fd: number,
  buffer: ArrayBuffer | string,
  offset: number = 0,
  length?: number,
  position?: number | bigint
): number {
  if (typeof buffer === "string") {
    buffer = ctx.stringToBytes(buffer).buffer;
  }
  length = length == null ? buffer.byteLength : length;
  const iovs = new IOVecs(
    new Uint8Array(buffer as ArrayBuffer, offset, length)
  );
  return ctx.fdTable.get(fd).write(iovs, position);
}

export function fstatSync(ctx: Context, fd: number): any {
  return createStats(ctx.fdTable.getFile(fd).filestat());
}

export function openSync(ctx: Context, path: string, flags: number): number {
  let oflags = 0;
  if ((flags & constants["O_CREAT"]) !== 0) {
    oflags |= wasi.OFLAGS_CREAT;
  }
  if ((flags & constants["O_DIRECTORY"]) !== 0) {
    oflags |= wasi.OFLAGS_DIRECTORY;
  }
  if ((flags & constants["O_EXCL"]) !== 0) {
    oflags |= wasi.OFLAGS_EXCL;
  }
  if ((flags & constants["O_TRUNC"]) !== 0) {
    oflags |= wasi.OFLAGS_TRUNC;
  }
  const file = ctx.rootDir.open(path, 0, oflags);
  return ctx.fdTable.push(file);
}

export function closeSync(ctx: Context, fd: number) {
  ctx.fdTable.remove(fd);
}

export function readlinkSync(_ctx: Context, _path: string): string {
  throw wasi.ERRNO_NOENT;
}

export function symlinkSync(_ctx: Context, _target: string, _path: string) {
  throw wasi.ERRNO_NOSYS;
}

export function readdirSync(ctx: Context, path: string): string[] {
  const dirents = ctx.rootDir.lookup(path).asDir().read();
  return dirents.map((dirent: wasi.Dirent) => dirent.name);
}

export function rmdirSync(ctx: Context, path: string) {
  ctx.rootDir.removeDir(path);
}

export function unlinkSync(ctx: Context, path: string) {
  ctx.rootDir.removeFile(path);
}

export function renameSync(ctx: Context, oldPath: string, newPath: string) {
  ctx.rootDir.rename(oldPath, ctx.rootDir, newPath);
}

export function writeFileSync(
  ctx: Context,
  file: string,
  data: ArrayBuffer | string | Blob
) {
  if (typeof data === "string") {
    data = ctx.stringToBytes(data).buffer;
  }
  const reg = ctx.rootDir
    .open(file, 0, wasi.OFLAGS_CREAT | wasi.OFLAGS_TRUNC)
    .asRegularFile();
  if (data instanceof Blob) {
    reg.writeBlob(data);
  } else {
    const iovs = new IOVecs(new Uint8Array(data as ArrayBuffer));
    reg.write(iovs);
  }
}

export function mkdirSync(ctx: Context, path: string) {
  ctx.rootDir.createDir(path);
}

export function truncateSync(ctx: Context, path: string, len: number = 0) {
  ctx.rootDir.lookup(path).asRegularFile().truncate(len);
}

export function utimesSync(
  _ctx: Context,
  _path: string,
  _atime: number | Date,
  _mtime: number | Date
) {}

export function chmodSync(
  _ctx: Context,
  _path: string,
  _mode: number | string
) {}

export function lstatSync(ctx: Context, path: string): any {
  return createStats(ctx.rootDir.lookup(path).filestat());
}

function createStats(filestat: wasi.Filestat): any {
  const atimMS = Number(filestat.atim) / 1e6;
  const mtimMS = Number(filestat.mtim) / 1e6;
  const ctimMS = Number(filestat.ctim) / 1e6;
  let mode = 0;
  switch (filestat.filetype) {
    case wasi.FILETYPE_REGULAR_FILE:
      mode = constants["S_IFREG"];
      break;
    case wasi.FILETYPE_DIRECTORY:
      mode = constants["S_IFDIR"];
      break;
    case wasi.FILETYPE_SYMBOLIC_LINK:
      mode = constants["S_IFLNK"];
      break;
  }
  return {
    ["dev"]: Number(filestat.dev),
    ["ino"]: Number(filestat.ino),
    ["mode"]: mode,
    ["nlink"]: Number(filestat.nlink),
    ["uid"]: 0,
    ["gid"]: 0,
    ["rdev"]: 0,
    ["size"]: Number(filestat.size),
    ["blksize"]: 0,
    ["blocks"]: 0,
    ["atimeMs"]: atimMS,
    ["mtimeMs"]: mtimMS,
    ["ctimeMs"]: ctimMS,
    ["birthtimeMs"]: 0,
    ["atime"]: new Date(atimMS),
    ["mtime"]: new Date(mtimMS),
    ["ctime"]: new Date(ctimMS),
    ["birthtime"]: new Date(),
  };
}
