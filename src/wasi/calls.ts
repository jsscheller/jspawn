import { Context } from "../context";
import * as t from "./types";
import * as e from "./errno";
import * as c from "./constants";
import { ExitStatus } from "../utils";
import { IOVecs } from "../ioVecs";

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
    ctx.fdTable.getRegularFile(fd).allocate(offset, len);
  },
  ["fd_close"]: function (ctx: Context, fd: number) {
    ctx.fdTable.remove(fd);
  },
  ["fd_datasync"]: function (ctx: Context, fd: number) {
    // Our filesystem has no concept of syncing to disk.
    ctx.fdTable.get(fd);
  },
  ["fd_fdstat_get"]: function (ctx: Context, fd: number, fdstatPtr: number) {
    const fdstat = ctx.fdTable.get(fd).fdstat();
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
    const filestat = ctx.fdTable.getFile(fd).filestat();
    t.filestat_t.set(ctx.mem, filestatPtr, filestat);
  },
  ["fd_filestat_set_size"]: function (ctx: Context, fd: number, size: bigint) {
    ctx.fdTable.getRegularFile(fd).truncate(size);
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
    const nread = ctx.fdTable.get(fd).read(iovs);
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
    const nread = ctx.fdTable.get(fd).read(iovs, offset);
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
    const nwritten = ctx.fdTable.get(fd).write(iovs);
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
    const nwritten = ctx.fdTable.get(fd).write(iovs, offset);
    t.size_t.set(ctx.mem, nwrittenPtr, nwritten);
  },
  ["fd_prestat_get"]: function (ctx: Context, fd: number, prestatPtr: number) {
    const prestat = ctx.fdTable.get(fd).prestat();
    t.prestat_t.set(ctx.mem, prestatPtr, prestat);
  },
  ["fd_prestat_dir_name"]: function (
    ctx: Context,
    fd: number,
    pathPtr: number,
    pathLen: number
  ) {
    const name = ctx.fdTable.get(fd).prestatDirName();
    t.string_t.set(ctx.mem, pathPtr, name, pathLen);
  },
  ["fd_renumber"]: function (ctx: Context, from: number, to: number) {
    ctx.fdTable.renumber(from, to);
  },
  ["fd_seek"]: function (
    ctx: Context,
    fd: number,
    offset: bigint,
    whence: number,
    filesizePtr: number
  ) {
    const newOffset = ctx.fdTable.get(fd).seek(offset, whence);
    t.filesize_t.set(ctx.mem, filesizePtr, newOffset);
  },
  ["fd_sync"]: function (ctx: Context, fd: number) {
    // Our filesystem has no concept of syncing to disk.
    ctx.fdTable.get(fd);
  },
  ["fd_tell"]: function (ctx: Context, fd: number, offsetPtr: number) {
    const offset = ctx.fdTable.get(fd).seek(BigInt(0), c.WHENCE_CUR);
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
    const ents = ctx.fdTable.getDir(fd).read(cookie, bufLen);
    let bufUsed = 0;
    for (const ent of ents) {
      // Copy as many bytes of the dirent as we can, up to the end of the buffer
      const direntCopyLen = Math.min(t.dirent_t.size, bufLen - bufUsed);
      t.dirent_t.set(ctx.mem, bufPtr, ent, direntCopyLen);

      // If the dirent struct wasnt copied entirely, return that we filled the buffer, which
      // tells libc that we're not at EOF.
      if (direntCopyLen < t.dirent_t.size) {
        bufUsed = bufLen;
        break;
      }

      bufPtr += direntCopyLen;
      bufUsed += direntCopyLen;

      // Copy as many bytes of the name as we can, up to the end of the buffer
      const nameCopyLen = Math.min(ent.name.length, bufLen - bufUsed);
      t.string_t.set(ctx.mem, bufPtr, ent.name, nameCopyLen);

      // If the dirent struct wasn't copied entirely, return that we filled the buffer, which
      // tells libc that we're not at EOF
      if (nameCopyLen < ent.name.length) {
        bufUsed = bufLen;
        break;
      }

      bufUsed += nameCopyLen;
    }
    t.size_t.set(ctx.mem, bufUsedPtr, bufUsed);
  },
  ["path_create_directory"]: function (
    ctx: Context,
    dirFd: number,
    pathPtr: number,
    pathLen: number
  ) {
    ctx.fdTable
      .getDir(dirFd)
      .createDir(t.string_t.get(ctx.mem, pathPtr, pathLen));
  },
  ["path_filestat_get"]: function (
    ctx: Context,
    dirFd: number,
    flags: number,
    pathPtr: number,
    pathLen: number,
    filestatPtr: number
  ) {
    const filestat = ctx.fdTable
      .getDir(dirFd)
      .lookup(t.string_t.get(ctx.mem, pathPtr, pathLen), flags)
      .filestat();
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
    ctx: Context,
    oldFd: number,
    oldFlags: number,
    oldPathPtr: number,
    oldPathLen: number,
    newFd: number,
    newPathPtr: number,
    newPathLen: number
  ) {
    const oldDir = ctx.fdTable.getDir(oldFd);
    const newDir = ctx.fdTable.getDir(newFd);
    const file = oldDir.lookup(
      t.string_t.get(ctx.mem, oldPathPtr, oldPathLen),
      oldFlags
    );
    newDir.insert(t.string_t.get(ctx.mem, newPathPtr, newPathLen), file);
  },
  ["path_open"]: function (
    ctx: Context,
    dirFd: number,
    dirFlags: number,
    pathPtr: number,
    pathLen: number,
    oflags: number,
    _fsRightsBaseRaw: bigint,
    _fsRightsInheritingRaw: bigint,
    _fdFlagsRaw: number,
    fdPtr: number
  ) {
    const file = ctx.fdTable
      .getDir(dirFd)
      .open(t.string_t.get(ctx.mem, pathPtr, pathLen), dirFlags, oflags);
    const fd = ctx.fdTable.push(file);
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
    dirFd: number,
    pathPtr: number,
    pathLen: number
  ) {
    ctx.fdTable
      .getDir(dirFd)
      .removeDir(t.string_t.get(ctx.mem, pathPtr, pathLen));
  },
  ["path_rename"]: function (
    ctx: Context,
    srcDirFd: number,
    srcPathPtr: number,
    srcPathLen: number,
    dstDirFd: number,
    dstPathPtr: number,
    dstPathLen: number
  ) {
    ctx.fdTable
      .getDir(srcDirFd)
      .rename(
        t.string_t.get(ctx.mem, srcPathPtr, srcPathLen),
        ctx.fdTable.getDir(dstDirFd),
        t.string_t.get(ctx.mem, dstPathPtr, dstPathLen)
      );
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
    dirFd: number,
    pathPtr: number,
    pathLen: number
  ) {
    ctx.fdTable
      .getDir(dirFd)
      .removeFile(t.string_t.get(ctx.mem, pathPtr, pathLen));
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
    crypto.getRandomValues(ctx.mem.u8.subarray(bufPtr, bufPtr + bufLen));
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
