import { Context } from "./context";
import * as t from "./types";
import * as e from "./errno";
import * as c from "./constants";
import { ExitStatus, isNode } from "../utils";
import { Memory } from "../memory";

let NODE_CRYPTO: any;

export const snapshotPreview1 = {
  ["args_get"]: function (ctx: Context, argvPtr: number, argvBufPtr: number) {
    t.cstringvec_t.set(ctx.mem, argvPtr, argvBufPtr, ctx.args);
  },
  ["args_sizes_get"]: function (
    ctx: Context,
    argcPtr: number,
    argvBufSizePtr: number
  ) {
    t.cstringvec_t.setSizes(ctx.mem, argcPtr, argvBufSizePtr, ctx.args);
  },
  ["clock_res_get"]: function (ctx: Context, _id: number, resultPtr: number) {
    t.uint64_t.set(ctx.mem, resultPtr, /* 1ms */ BigInt(1000000));
  },
  ["clock_time_get"]: function (
    ctx: Context,
    id: number,
    _precision: bigint,
    resultPtr: number
  ) {
    const origin = id !== c.CLOCKID_REALTIME ? performance : Date;
    t.uint64_t.set(
      ctx.mem,
      resultPtr,
      BigInt(Math.round(origin.now() * 1000000))
    );
  },
  ["environ_get"]: function (
    ctx: Context,
    environPtr: number,
    environBufPtr: number
  ) {
    t.cstringvec_t.set(ctx.mem, environPtr, environBufPtr, ctx.envs);
  },
  ["environ_sizes_get"]: function (
    ctx: Context,
    countPtr: number,
    sizePtr: number
  ) {
    t.cstringvec_t.setSizes(ctx.mem, countPtr, sizePtr, ctx.envs);
  },
  ["fd_advise"]: function (
    _fd: number,
    _offset: bigint,
    _length: bigint,
    _advice: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["fd_allocate"]: function (
    ctx: Context,
    fd: number,
    offset: bigint,
    len: bigint
  ) {
    ctx.fs.fallocateSync(fd, offset, len);
  },
  ["fd_close"]: function (ctx: Context, fd: number) {
    ctx.fs.closeSync(fd);
  },
  ["fd_datasync"]: function (ctx: Context, fd: number) {
    // Our filesystem has no concept of syncing to disk.
    ctx.fs.fstatSync(fd);
  },
  ["fd_fdstat_get"]: function (ctx: Context, fd: number, fdstatPtr: number) {
    const filestat = ctx.fs.fstatSync(fd) as t.Filestat;
    const fdstat = new t.Fdstat([filestat.filetype, 0, BigInt(0), BigInt(0)]);
    t.fdstat_t.set(ctx.mem, fdstatPtr, fdstat);
  },
  ["fd_fdstat_set_flags"]: function (
    _ctx: Context,
    _fd: number,
    _flags: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["fd_fdstat_set_rights"]: function (
    _fd: number,
    _rightsBase: bigint,
    _rightsInheriting: bigint
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["fd_filestat_get"]: function (
    ctx: Context,
    fd: number,
    filestatPtr: number
  ) {
    const filestat = ctx.fs.fstatSync(fd) as t.Filestat;
    t.filestat_t.set(ctx.mem, filestatPtr, filestat);
  },
  ["fd_filestat_set_size"]: function (ctx: Context, fd: number, size: bigint) {
    ctx.fs.ftruncateSync(fd, size);
  },
  ["fd_filestat_set_times"]: function (
    _fd: number,
    _atim: bigint,
    _mtim: bigint,
    _flags: number
  ) {},
  ["fd_read"]: function (
    ctx: Context,
    fd: number,
    iovsPtr: number,
    iovsLen: number,
    nreadPtr: number
  ) {
    const iovs = new IOVecs(iovsPtr, iovsLen, ctx.mem);
    let nread = 0;
    for (const buf of iovs.bufs) {
      nread += ctx.fs.readSync(fd, buf.buffer, buf.byteOffset, buf.length);
    }
    t.size_t.set(ctx.mem, nreadPtr, nread);
  },
  ["fd_pread"]: function (
    ctx: Context,
    fd: number,
    iovsPtr: number,
    iovsLen: number,
    offset: bigint,
    nreadPtr: number
  ) {
    const iovs = new IOVecs(iovsPtr, iovsLen, ctx.mem);
    let nread = 0;
    for (const buf of iovs.bufs) {
      nread += ctx.fs.readSync(
        fd,
        buf.buffer,
        buf.byteOffset,
        buf.length,
        offset
      );
    }
    t.size_t.set(ctx.mem, nreadPtr, nread);
  },
  ["fd_write"]: function (
    ctx: Context,
    fd: number,
    iovsPtr: number,
    iovsLen: number,
    nwrittenPtr: number
  ) {
    const iovs = new IOVecs(iovsPtr, iovsLen, ctx.mem);
    let nwritten = 0;
    for (const buf of iovs.bufs) {
      nwritten += ctx.fs.writeSync(fd, buf.buffer, buf.byteOffset, buf.length);
    }
    t.size_t.set(ctx.mem, nwrittenPtr, nwritten);
  },
  ["fd_pwrite"]: function (
    ctx: Context,
    fd: number,
    iovsPtr: number,
    iovsLen: number,
    offset: bigint,
    nwrittenPtr: number
  ) {
    const iovs = new IOVecs(iovsPtr, iovsLen, ctx.mem);
    let nwritten = 0;
    for (const buf of iovs.bufs) {
      nwritten += ctx.fs.writeSync(
        fd,
        buf.buffer,
        buf.byteOffset,
        buf.length,
        offset
      );
    }
    t.size_t.set(ctx.mem, nwrittenPtr, nwritten);
  },
  ["fd_prestat_get"]: function (ctx: Context, fd: number, prestatPtr: number) {
    const name = ctx.fs.prestatDirNameSync(fd);
    const prestat = new t.Prestat([0, name.length]);
    t.prestat_t.set(ctx.mem, prestatPtr, prestat);
  },
  ["fd_prestat_dir_name"]: function (
    ctx: Context,
    fd: number,
    pathPtr: number,
    pathLen: number
  ) {
    const name = ctx.fs.prestatDirNameSync(fd);
    t.string_t.set(ctx.mem, pathPtr, name, pathLen);
  },
  ["fd_renumber"]: function (ctx: Context, from: number, to: number) {
    ctx.fs.renumberSync(from, to);
  },
  ["fd_seek"]: function (
    ctx: Context,
    fd: number,
    offset: bigint,
    whence: number,
    filesizePtr: number
  ) {
    const newOffset = ctx.fs.seekSync(fd, offset, whence);
    t.filesize_t.set(ctx.mem, filesizePtr, newOffset);
  },
  ["fd_sync"]: function (ctx: Context, fd: number) {
    // Our filesystem has no concept of syncing to disk.
    ctx.fs.fstatSync(fd);
  },
  ["fd_tell"]: function (ctx: Context, fd: number, offsetPtr: number) {
    const offset = ctx.fs.seekSync(fd, BigInt(0), c.WHENCE_CUR);
    t.filesize_t.set(ctx.mem, offsetPtr, offset);
  },
  ["fd_readdir"]: function (
    ctx: Context,
    fd: number,
    bufPtr: number,
    bufLen: number,
    cookie: bigint,
    bufUsedPtr: number
  ) {
    const ents = ctx.fs.freaddirSync(fd, cookie);
    let bufUsed = 0;
    for (const ent of ents) {
      const dirent = new t.Dirent([
        ent.cookie + BigInt(1),
        BigInt(0),
        ent.name.length,
        ent.type,
      ]);
      // Copy as many bytes of the dirent as we can, up to the end of the buffer
      const direntCopyLen = Math.min(t.dirent_t.size, bufLen - bufUsed);
      t.dirent_t.set(ctx.mem, bufPtr, dirent, direntCopyLen);

      // If the dirent struct wasnt copied entirely, return that we filled the buffer, which
      // tells libc that we're not at EOF.
      if (direntCopyLen < t.dirent_t.size) {
        bufUsed = bufLen;
        break;
      }

      bufPtr += direntCopyLen;
      bufUsed += direntCopyLen;

      // Copy as many bytes of the name as we can, up to the end of the buffer
      const nameCopyLen = Math.min(dirent.name.length, bufLen - bufUsed);
      t.string_t.set(ctx.mem, bufPtr, dirent.name, nameCopyLen);

      // If the dirent struct wasn't copied entirely, return that we filled the buffer, which
      // tells libc that we're not at EOF
      if (nameCopyLen < dirent.name.length) {
        bufUsed = bufLen;
        break;
      }

      bufUsed += nameCopyLen;
    }
    t.size_t.set(ctx.mem, bufUsedPtr, bufUsed);
  },
  ["path_create_directory"]: function (
    ctx: Context,
    _dirFd: number,
    pathPtr: number,
    pathLen: number
  ) {
    const path = ctx.readPath(pathPtr, pathLen);
    ctx.fs.mkdirSync(path);
  },
  ["path_filestat_get"]: function (
    ctx: Context,
    _dirFd: number,
    _flags: number,
    pathPtr: number,
    pathLen: number,
    filestatPtr: number
  ) {
    const path = ctx.readPath(pathPtr, pathLen);
    const filestat = ctx.fs.lstatSync(path);
    t.filestat_t.set(ctx.mem, filestatPtr, filestat);
  },
  ["path_filestat_set_times"]: function (
    _ctx: Context,
    _dirfd: number,
    _flags: number,
    _path: number,
    _atim: bigint,
    _mtim: bigint,
    _fstflags: number
  ) {},
  ["path_link"]: function (
    _ctx: Context,
    _oldFd: number,
    _oldFlags: number,
    _oldPathPtr: number,
    _oldPathLen: number,
    _newFd: number,
    _newPathPtr: number,
    _newPathLen: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["path_open"]: function (
    ctx: Context,
    _dirFd: number,
    _dirFlags: number,
    pathPtr: number,
    pathLen: number,
    oflags: number,
    _fsRightsBaseRaw: bigint,
    _fsRightsInheritingRaw: bigint,
    fdflags: number,
    fdPtr: number
  ) {
    const path = ctx.readPath(pathPtr, pathLen);
    const fd = ctx.fs.openSync(path, oflags, fdflags);
    t.fd_t.set(ctx.mem, fdPtr, fd);
  },
  ["path_readlink"]: function (
    _ctx: Context,
    _dirFd: number,
    _pathPtr: number,
    _pathLen: number,
    _bufPtr: number,
    _bufLen: number,
    _bufUsedPtr: number
  ) {
    throw e.ERRNO_NOENT;
  },
  ["path_remove_directory"]: function (
    ctx: Context,
    _dirFd: number,
    pathPtr: number,
    pathLen: number
  ) {
    const path = ctx.readPath(pathPtr, pathLen);
    ctx.fs.rmdirSync(path);
  },
  ["path_rename"]: function (
    ctx: Context,
    _srcDirFd: number,
    srcPathPtr: number,
    srcPathLen: number,
    _dstDirFd: number,
    dstPathPtr: number,
    dstPathLen: number
  ) {
    const srcPath = ctx.readPath(srcPathPtr, srcPathLen);
    const dstPath = ctx.readPath(dstPathPtr, dstPathLen);
    ctx.fs.renameSync(srcPath, dstPath);
  },
  ["path_symlink"]: function (
    _ctx: Context,
    _oldPath: number,
    _fd: number,
    _newPath: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["path_unlink_file"]: function (
    ctx: Context,
    _dirFd: number,
    pathPtr: number,
    pathLen: number
  ) {
    const path = ctx.readPath(pathPtr, pathLen);
    ctx.fs.unlinkSync(path);
  },
  ["poll_oneoff"]: function (
    _ctx: Context,
    _inOffset: number,
    _outOffset: number,
    _nsubscriptions: number,
    _neventsOffset: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["proc_exit"]: function (_ctx: Context, code: number) {
    throw new ExitStatus(code);
  },
  ["proc_raise"]: function (_ctx: Context, _sig: number) {
    throw e.ERRNO_NOSYS;
  },
  ["random_get"]: function (ctx: Context, bufPtr: number, bufLen: number) {
    const buf = ctx.mem.u8.subarray(bufPtr, bufPtr + bufLen);
    if (isNode()) {
      // @ts-ignore
      NODE_CRYPTO = NODE_CRYPTO || require("crypto");
      buf.set(NODE_CRYPTO["randomBytes"](buf.length));
    } else {
      crypto.getRandomValues(buf);
    }
  },
  ["sched_yield"]: function (_ctx: Context) {},
  ["sock_recv"]: function (
    _ctx: Context,
    _fd: number,
    _riDataOffset: number,
    _riDataLength: number,
    _riFlags: number,
    _roDataLengthOffset: number,
    _roFlagsOffset: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["sock_send"]: function (
    _ctx: Context,
    _fd: number,
    _siDataOffset: number,
    _siDataLength: number,
    _siFlags: number,
    _soDataLengthOffset: number
  ) {
    throw e.ERRNO_NOSYS;
  },
  ["sock_shutdown"]: function (_ctx: Context, _fd: number, _how: number) {
    throw e.ERRNO_NOSYS;
  },
};

class IOVecs {
  bufs: Uint8Array[];

  constructor(
    ptr: number | Uint8Array | Uint8Array[],
    len?: number,
    mem?: Memory
  ) {
    if (ptr instanceof Uint8Array) {
      this.bufs = [ptr];
    } else if (Array.isArray(ptr)) {
      this.bufs = ptr;
    } else {
      this.bufs = [];
      for (let i = 0; i < len!; i++) {
        const [iovecBufPtr, iovecBufLen] = t.iovec_t.get(mem!, ptr)
          .values as number[];
        this.bufs.push(
          mem!.u8.subarray(iovecBufPtr, iovecBufPtr + iovecBufLen)
        );
        ptr += t.iovec_t.size;
      }
    }
  }
}
