import * as wasi from "./wasi/index";
import { Memory } from "./memory";
import { isPlainObject, isNode, loadNodeModule } from "./utils";

const enum FSRequest {
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
  CWD,
}

declare type Dirent = {
  name: string;
  type: number;
  cookie: bigint;
};

declare type ReaddirOptions = {
  withFileTypes?: boolean;
};
declare type RmdirOptions = {
  recursive?: boolean;
};

export type FromWorkerMessage = {
  id: number;
  out: any;
};

export type ToWorkerMessage = {
  clientId: number;
  req: FSRequest;
  args: any[];
  bufs: Uint8Array[];
  id?: number;
  slot?: number;
};

type Buffer =
  | ArrayBuffer
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | BigUint64Array
  | BigInt64Array;

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

export class FileSystem {
  bindings!: Bindings;
  isNodeAPI: boolean;
  textEncoder: TextEncoder;

  constructor(isNodeAPI: boolean = false) {
    this.isNodeAPI = isNodeAPI;
    this.textEncoder = new TextEncoder();
  }

  static async compile(wasmPath: string): Promise<WebAssembly.Module> {
    if (isNode()) {
      const nodeFS = await loadNodeModule("fs/promises");
      const sep = (await loadNodeModule("path"))["sep"];
      return WebAssembly.compile(
        await nodeFS.readFile(wasmPath.replace(`file:${sep}${sep}`, ""))
      );
    } else {
      return await WebAssembly.compileStreaming(fetch(wasmPath));
    }
  }

  static async instantiate(
    module: WebAssembly.Module,
    mem: WebAssembly.Memory
  ): Promise<FileSystem> {
    const fs = new FileSystem();
    fs.bindings = await Bindings.instantiate(module, mem);
    return fs;
  }

  nodeFS(): FileSystem {
    const fs = new FileSystem(true);
    fs.bindings = this.bindings;
    return fs;
  }

  requestSync(req: FSRequest, args: any[], bufs: Buffer[] = []): any {
    try {
      const uint8Bufs = bufs.map(toUint8);
      const out = this.bindings!.requestSync(req, args, uint8Bufs);
      return this.handleOut(out);
    } catch (err) {
      this.handleErr(err);
    }
  }

  handleOut(out: any): any {
    return typeof out === "string" ? JSON.parse(out) : out;
  }

  handleErr(err: any): never {
    if (typeof err === "number") {
      this.throwErrno(err);
    } else {
      throw err;
    }
  }

  throwErrno(errno: number): never {
    if (this.isNodeAPI) {
      throw { ["code"]: "E" + wasi.errnoName(errno) };
    } else {
      throw errno;
    }
  }

  readSync(
    fd: number,
    buffer: Buffer,
    offset: number = 0,
    length?: number,
    position?: number | bigint
  ): number {
    length = length == null ? buffer.byteLength : length;
    return this.requestSync(
      FSRequest.ReadSync,
      [fd, big(position)],
      [toUint8(buffer).subarray(offset, offset + length!)]
    );
  }

  writeSync(
    fd: number,
    buffer: Buffer | string,
    offset: number = 0,
    length?: number,
    position?: number | bigint
  ): number {
    if (typeof buffer === "string") {
      buffer = this.textEncoder.encode(buffer);
    }
    length = length == null ? buffer.byteLength : length;
    return this.requestSync(
      FSRequest.WriteSync,
      [fd, big(length), big(position)],
      [toUint8(buffer as ArrayBuffer).subarray(offset, offset + length!)]
    );
  }

  fstatSync(fd: number): wasi.Filestat | any {
    return createStats(
      this.requestSync(FSRequest.FstatSync, [fd]),
      this.isNodeAPI
    );
  }

  openSync(path: string, flags: number, fdflags: number = 0): number {
    let oflags = flags;
    if (this.isNodeAPI) {
      oflags = 0;
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
    }
    return this.requestSync(FSRequest.OpenSync, [path, oflags, fdflags]);
  }

  closeSync(fd: number) {
    this.requestSync(FSRequest.CloseSync, [fd]);
  }

  readlinkSync(_path: string): string {
    this.throwErrno(wasi.ERRNO_NOENT);
  }

  symlinkSync(_target: string, _path: string) {
    this.throwErrno(wasi.ERRNO_NOSYS);
  }

  readdirSync(path: string, opts: ReaddirOptions = {}): (string | Dirent)[] {
    return this.requestSync(FSRequest.ReaddirSync, [
      path,
      opts.withFileTypes || false,
    ]);
  }

  freaddirSync(fd: number, cookie: bigint): Dirent[] {
    return this.requestSync(FSRequest.FreaddirSync, [fd, cookie]);
  }

  rmdirSync(path: string, opts: RmdirOptions = {}) {
    this.requestSync(FSRequest.RmdirSync, [path, opts.recursive || false]);
  }

  unlinkSync(path: string) {
    this.requestSync(FSRequest.UnlinkSync, [path]);
  }

  renameSync(oldPath: string, newPath: string) {
    this.requestSync(FSRequest.RenameSync, [oldPath, newPath]);
  }

  writeFileSync(path: string, data: Buffer | string | Blob | URL) {
    if (typeof data === "string") {
      data = this.textEncoder.encode(data).buffer;
    }
    let bufs: Uint8Array[] = [];
    let url: string | undefined;
    if (isBuffer(data)) {
      data = toUint8(data as Buffer);
      bufs = [data as Uint8Array];
    } else {
      if (data instanceof Blob) {
        url = URL.createObjectURL(data);
      } else {
        url = (data as URL).toString();
      }
    }
    this.requestSync(
      FSRequest.WriteFileSync,
      [path, data instanceof Uint8Array ? data.length : 0, url],
      bufs
    );
  }

  readFile(path: string): Promise<ArrayBuffer> {
    return this.requestSync(FSRequest.ReadFile, [path]);
  }

  mkdirSync(path: string) {
    this.requestSync(FSRequest.MkdirSync, [path]);
  }

  truncateSync(path: string, size: number = 0) {
    this.requestSync(FSRequest.TruncateSync, [path, big(size)]);
  }

  ftruncateSync(fd: number, size: bigint) {
    this.requestSync(FSRequest.FtruncateSync, [fd, size]);
  }

  fallocateSync(fd: number, offset: bigint, size: bigint) {
    this.requestSync(FSRequest.FallocateSync, [fd, offset, size]);
  }

  utimesSync(_path: string, _atime: number | Date, _mtime: number | Date) {}

  chmodSync(_path: string, _mode: number | string) {}

  lstatSync(path: string): wasi.Filestat | any {
    return createStats(
      this.requestSync(FSRequest.LstatSync, [path]),
      this.isNodeAPI
    );
  }

  async readFileToBlob(path: string, type?: string): Promise<Blob> {
    const buf = await this.readFile(path);
    return new Blob([buf], { type });
  }

  prestatDirNameSync(fd: number): string {
    return this.requestSync(FSRequest.PrestatDirNameSync, [fd]);
  }

  renumberSync(from: number, to: number) {
    return this.requestSync(FSRequest.RenumberSync, [from, to]);
  }

  seekSync(fd: number, offset: bigint, whence: number): bigint {
    return BigInt(this.requestSync(FSRequest.SeekSync, [fd, offset, whence]));
  }

  mount(
    source: string | Blob | Uint8Array | { [path: string]: any },
    virtualPath: string
  ) {
    this.requestSync(FSRequest.Mount, [
      isNode(),
      serMountArgs(source, virtualPath).join("\n"),
    ]);
  }

  chdir(dir: string) {
    this.requestSync(FSRequest.Chdir, [dir]);
  }

  cwd(): string {
    return this.requestSync(FSRequest.CWD, []);
  }
}

function serMountArgs(
  src: string | Blob | Uint8Array | { [path: string]: any },
  accPath: string,
  acc: string[] = []
): string[] {
  if (isPlainObject(src)) {
    acc.push("", accPath);
    for (const [key, val] of Object.entries(src)) {
      serMountArgs(val, `${accPath}/${key}`, acc);
    }
  } else {
    if (src instanceof Uint8Array) {
      src = new Blob([src]);
    }
    if (src instanceof Blob) {
      src = URL.createObjectURL(src);
    }
    acc.push(src as string, accPath);
  }
  return acc;
}

function isBuffer(x: any): boolean {
  return "byteLength" in x;
}

function toUint8(buf: Buffer): Uint8Array {
  if (buf instanceof Uint8Array) {
    return buf;
  } else if (buf instanceof ArrayBuffer || buf instanceof SharedArrayBuffer) {
    return new Uint8Array(buf);
  } else {
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
}

function big(n: bigint | number | undefined): bigint | undefined {
  if (typeof n === "number") {
    n = BigInt(n);
  }
  return n as bigint | undefined;
}

function createStats(stat: any, isNodeAPI: boolean): wasi.Filestat | any {
  const filestat = new wasi.Filestat([
    BigInt(0),
    BigInt(0),
    stat["filetype"],
    BigInt(0),
    BigInt(stat["size"]),
    BigInt(0),
    BigInt(0),
    BigInt(0),
  ]);

  if (!isNodeAPI) return filestat;

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

export class Bindings {
  fetchCache: { [k: string]: Uint8Array };
  textDecoder: TextDecoder;
  textEncoder: TextEncoder;
  exports!: any;
  mem!: Memory;
  nodePath!: any;
  nodeFS!: any;
  buf?: Uint8Array;
  out?: any;

  constructor() {
    this.fetchCache = {};
    this.textDecoder = new TextDecoder();
    this.textEncoder = new TextEncoder();
    if (isNode()) {
      // @ts-ignore
      this.nodePath = require("path");
      // @ts-ignore
      this.nodeFS = require("fs");
    }
  }

  static async instantiate(
    module: WebAssembly.Module,
    mem: WebAssembly.Memory
  ): Promise<Bindings> {
    const bindings = new Bindings();
    const instance = await WebAssembly.instantiate(module, {
      ["env"]: {
        ["memory"]: mem,
        ...bindings.imports(),
      },
    });
    bindings.exports = instance.exports;
    bindings.mem = new Memory(mem);
    return bindings;
  }

  imports(): any {
    const bindings = this;
    return {
      ["url_read"](
        urlPtr: number,
        urlLen: number,
        pos: bigint,
        nreadPtr: number
      ): number {
        try {
          const url = bindings.readString(urlPtr, urlLen);
          let nread = BigInt(bindings.buf!.length);
          const buf = bindings.fetchBufSync(url);
          const len = buf.length;

          nread = min(nread, max(BigInt(0), BigInt(len) - pos));
          const start = Number(pos);
          const end = start + Number(nread);
          bindings.buf!.set(buf.subarray(start, end));
          bindings.mem.dv.setBigUint64(nreadPtr, nread, true);

          return 0;
        } catch (err) {
          console.error(err);
          return 1;
        }
      },
      ["url_len"](urlPtr: number, urlLen: number): bigint {
        try {
          const url = bindings.readString(urlPtr, urlLen);
          let len: string | number | null = null;
          if (isNodeFile(url)) {
            // @ts-ignore
            len = require("fs")["statSync"](nodeFilePath(url))["size"];
          } else if (!url.startsWith("blob:")) {
            // HEAD requests don't work for blob URLs.
            const xhr = new XMLHttpRequest();
            xhr.open("HEAD", url, false);
            xhr.send();
            // `getResponseHeader` will log an error in Chromium if the header is not present.
            // The log looks something like: `Refused to get unsafe header`.
            if (xhr.getResponseHeader("content-encoding")) {
              for (const serverPrefix of ["x-amz-meta", "x"]) {
                for (const prefix of ["de", "un"]) {
                  const header = `${serverPrefix}-${prefix}compressed-content-length`;
                  len = xhr.getResponseHeader(header);
                  if (len) break;
                }
              }
            } else {
              len = xhr.getResponseHeader("content-length");
            }
          }
          if (typeof len === "string") {
            len = parseInt(len);
          }
          if (isNaN(len as number) || len == null) {
            const buf = bindings.fetchBufSync(url);
            len = buf.length;
          }
          return BigInt(len as number);
        } catch (err) {
          console.error(err);
          return BigInt(0);
        }
      },
      ["url_buf"](urlPtr: number, urlLen: number, lenPtr: number): number {
        try {
          const url = bindings.readString(urlPtr, urlLen);
          const buf = bindings.fetchBufSync(url);
          const ptr = bindings.alloc(buf.length);
          bindings.mem.u8.set(buf, ptr);
          bindings.mem.dv.setBigUint64(lenPtr, BigInt(buf.length), true);
          return ptr;
        } catch (err) {
          console.error(err);
          return 0;
        }
      },
      ["url_free"](urlPtr: number, urlLen: number) {
        const url = bindings.readString(urlPtr, urlLen);
        delete bindings.fetchCache[url];
        if (url.startsWith("blob:")) {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {}
        }
      },
      ["node_readdir"](
        pathPtr: number,
        pathLen: number,
        lenPtr: number
      ): number {
        try {
          const path = bindings.readString(pathPtr, pathLen);
          // @ts-ignore
          const dirents = bindings.nodeFS["readdirSync"](path, {
            ["withFileTypes"]: true,
          });
          const acc = [];
          for (const dirent of dirents) {
            const name = dirent["name"];
            let src = bindings.nodePath["join"](path, name);
            if (dirent["isFile"]()) {
              src = `file://${src}`;
            } else if (!dirent["isDirectory"]()) {
              continue;
            }
            acc.push(src, name);
          }
          const sPtr = bindings.writeString(acc.join("\n") || " ");
          bindings.mem.dv.setUint32(lenPtr, sPtr.len, true);
          return sPtr.ptr;
        } catch (err) {
          console.error(err);
          return 0;
        }
      },
      ["read"](
        ptr: number,
        len: number,
        pos: bigint,
        nreadPtr: number
      ): number {
        try {
          let nread = BigInt(bindings.buf!.length);
          nread = min(nread, max(BigInt(0), BigInt(len) - pos));
          const start = ptr + Number(pos);
          const end = start + Number(nread);
          bindings.buf!.set(bindings.mem.u8.subarray(start, end));
          bindings.mem.dv.setBigUint64(nreadPtr, nread, true);
          return 0;
        } catch (err) {
          console.error(err);
          return 1;
        }
      },
      ["write"](ptr: number) {
        bindings.mem.u8.set(bindings.buf!, ptr);
      },
      ["set_buf"](size: bigint) {
        bindings.buf = new Uint8Array(Number(size));
      },
      ["out"](ptr: number, len: number) {
        bindings.out = bindings.readString(ptr, len);
      },
      ["println"](ptr: number, len: number) {
        console.log(bindings.readString(ptr, len));
      },
    };
  }

  alloc(len: number): number {
    return this.exports["alloc"](len);
  }

  readString(ptr: number, len: number): string {
    // Text encoding/decoding not supported for SAB-backed views.
    // https://github.com/whatwg/encoding/issues/172
    const bytes = this.mem.isShared
      ? this.mem.u8.slice(ptr, ptr + len)
      : this.mem.u8.subarray(ptr, ptr + len);
    return this.textDecoder.decode(bytes);
  }

  writeString(s: string): { ptr: number; len: number } {
    const bytes = this.textEncoder.encode(s);
    const ptr = this.alloc(bytes.length);
    this.mem.u8.set(bytes, ptr);
    return { ptr, len: bytes.length };
  }

  fetchBufSync(url: string): Uint8Array {
    const cached = this.fetchCache[url];
    if (cached) return cached;

    let buf;
    if (isNodeFile(url)) {
      // @ts-ignore
      buf = require("fs")["readFileSync"](nodeFilePath(url));
    } else {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, false);
      xhr.responseType = "arraybuffer";
      xhr.send();
      buf = new Uint8Array(xhr.response);
    }
    return (this.fetchCache[url] = buf);
  }

  requestSync(
    req: FSRequest,
    args: any[],
    bufs: Uint8Array[]
  ): string | Uint8Array | undefined {
    this.buf = bufs[0];
    delete this.out;
    const ptr = args.length ? this.writeArgs(args) : 0;
    const errno = this.exports["request"](req, ptr, args.length);
    if (errno) throw errno;
    return this.out ? this.out : this.buf;
  }

  writeArgs(args: any[]): number {
    const argSize = 9;
    const size = args.length * argSize;
    const ptr = this.alloc(size);
    const dv = new DataView(this.mem.u8.buffer, ptr, size);
    let offset = 0;
    let type = 0;
    for (const arg of args) {
      if (typeof arg === "string") {
        type = 1;
        const sPtr = this.writeString(arg);
        dv.setUint32(offset + 1, sPtr.ptr, true);
        dv.setUint32(offset + 1 + 4, sPtr.len, true);
      } else if (typeof arg === "number") {
        type = 2;
        dv.setUint32(offset + 1, arg, true);
      } else if (typeof arg === "bigint") {
        type = 3;
        dv.setBigUint64(offset + 1, arg, true);
      } else if (typeof arg === "boolean") {
        type = 4;
        dv.setUint8(offset + 1, arg ? 1 : 0);
      } else {
        type = 0;
      }
      dv.setUint8(offset, type);
      offset += argSize;
    }
    return ptr;
  }
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function isNodeFile(url: string): boolean {
  return isNode() && url.startsWith("file:");
}

function nodeFilePath(url: string): string {
  return url.replace("file://", "");
}
