import * as wasi from "./wasi/index";
import { resizeBuffer, Cell, unreachable } from "./utils";
import { IOVecs } from "./ioVecs";

export class File {
  fileType(): number {
    defaultImpl();
  }

  asRegularFile(): RegularFile {
    defaultImpl();
  }

  asDir(): Dir {
    defaultImpl();
  }

  filestat(): wasi.Filestat {
    defaultImpl();
  }
}

function defaultImpl(): never {
  throw wasi.ERRNO_BADF;
}

export class RegularFile extends File {
  buf?: Uint8Array;
  blob?: Blob;
  size: number;

  constructor(src?: Uint8Array | Blob) {
    super();
    if (src instanceof Blob) {
      this.blob = src;
      this.size = src.size;
    } else {
      this.buf = src;
      this.size = src ? src.length : 0;
    }
  }

  fileType(): number {
    return wasi.FILETYPE_REGULAR_FILE;
  }

  asRegularFile(): RegularFile {
    return this;
  }

  filestat(): wasi.Filestat {
    return new wasi.Filestat([
      BigInt(0),
      BigInt(0),
      this.fileType(),
      BigInt(0),
      BigInt(this.size),
      BigInt(0),
      BigInt(0),
      BigInt(0),
    ]);
  }

  toBuf() {
    if (this.blob) {
      this.buf = new Uint8Array(lazyFileReader().readAsArrayBuffer(this.blob));
      this.blob = undefined;
    }
  }

  allocate(offset: bigint | number, len: bigint | number) {
    const newSize = Number(offset) + Number(len);

    if (this.size >= newSize) {
      return;
    }

    this.toBuf();
    this.buf = resizeBuffer(this.buf!, newSize, this.size);
    this.size = newSize;
  }

  truncate(newSize: bigint | number) {
    newSize = Number(newSize);
    if (newSize === 0) {
      this.buf = this.blob = undefined;
    } else if (newSize > this.size) {
      this.allocate(0, newSize);
    } else if (this.blob) {
      this.blob = this.blob.slice(0, newSize);
    } else if (newSize !== this.size) {
      const prevBuf = this.buf;
      this.buf = new Uint8Array(newSize);
      if (prevBuf) {
        // Copy old data over to the new storage.
        this.buf!.set(prevBuf.subarray(0, newSize));
      }
    }
    this.size = newSize;
  }

  read(iovs: IOVecs, pos: bigint | number): number {
    pos = Number(pos);
    let nread = 0;
    for (const buf of iovs.bufs) {
      if (pos >= this.size) {
        break;
      }
      let n = Math.min(this.size - pos, buf.length);
      if (this.blob) {
        buf.set(
          new Uint8Array(
            lazyFileReader().readAsArrayBuffer(this.blob.slice(pos, pos + n))
          )
        );
      } else if (n > 8) {
        buf.set(this.buf!.subarray(pos, pos + n));
      } else {
        for (let i = 0; i < n; i++) {
          buf[i] = this.buf![pos + i];
        }
      }
      pos += n;
      nread += n;
    }
    return nread;
  }

  readToBlob(): Blob {
    if (!this.blob) {
      const buf = this.buf || new Uint8Array();
      this.blob = new Blob([buf.subarray(0, this.size)]);
      delete this.buf;
    }
    return this.blob!;
  }

  write(iovs: IOVecs, pos: bigint | number = 0): number {
    pos = Number(pos);
    let nwritten = 0;
    for (const buf of iovs.bufs) {
      const n = buf.length;

      if (n === 0) {
        continue;
      }

      if (pos === 0 && this.size === 0) {
        // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
        this.buf = buf.slice();
        this.size = n;
      } else {
        this.toBuf();
        if (pos + n <= this.size) {
          // Writing to an already allocated and used subrange of the file.
          this.buf!.set(buf, pos);
        } else {
          // Appending to an existing file and we need to reallocate.
          this.buf = resizeBuffer(this.buf!, pos + n, this.size);
          this.buf!.set(buf, pos);
          this.size = pos + n;
        }
      }
      nwritten += n;
    }
    return nwritten;
  }

  writeBlob(blob: Blob, pos: bigint | number = 0): number {
    if (pos !== 0 || this.size !== 0) {
      unreachable();
    }
    delete this.buf;
    this.blob = blob;
    return (this.size = this.blob.size);
  }
}

// Taken from https://github.com/Microsoft/TypeScript/blob/main/src/lib/webworker.generated.d.ts
/** Allows to read File or Blob objects in a synchronous way. */
interface FileReaderSync {
  readAsArrayBuffer(blob: Blob): ArrayBuffer;
  /** @deprecated */
  readAsBinaryString(blob: Blob): string;
  readAsDataURL(blob: Blob): string;
  readAsText(blob: Blob, encoding?: string): string;
}

declare var FileReaderSync: {
  prototype: FileReaderSync;
  new (): FileReaderSync;
};

let _lazyFileReader: FileReaderSync | undefined;
function lazyFileReader(): FileReaderSync {
  return (_lazyFileReader = _lazyFileReader || new FileReaderSync());
}

export class Dir extends File {
  entries: Map<string, File>;
  entryIDs: WeakMap<File, bigint>;
  nextID: bigint;
  relative?: string;
  currentDir?: Cell<string>;
  isPreopen?: boolean;

  constructor(
    src?: { [path: string]: File },
    relative?: string,
    currentDir?: Cell<string>,
    isPreopen?: boolean
  ) {
    super();
    this.entries = new Map();
    this.entryIDs = new WeakMap();
    this.nextID = BigInt(1);
    this.relative = relative;
    this.currentDir = currentDir;
    this.isPreopen = isPreopen;

    if (src) {
      for (const [path, entry] of Object.entries(src)) {
        this.entries.set(path, entry);
        this.entryIDs.set(entry, this.nextID++);
      }
    }
  }

  fileType(): number {
    return wasi.FILETYPE_DIRECTORY;
  }

  asDir(): Dir {
    return this;
  }

  filestat(): wasi.Filestat {
    return new wasi.Filestat([
      BigInt(0),
      BigInt(0),
      this.fileType(),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(0),
    ]);
  }

  resolvePath(path: string, allowAbsolute?: boolean): string {
    if (this.relative != null && (path[0] !== "/" || !allowAbsolute)) {
      let absPath;
      if (this.relative === "..") {
        absPath = this.currentDir!.value;
        while (true) {
          if (!absPath) {
            throw wasi.ERRNO_NOTCAPABLE;
          }
          absPath = absPath.slice(0, absPath.lastIndexOf("/") + 1);
          if (path.startsWith("..")) {
            path = path.slice(3);
          } else {
            break;
          }
        }
        if (path) {
          absPath = absPath ? absPath + "/" + path : path;
        }
      } else if (this.relative === "~") {
        absPath = path;
      } else {
        absPath = this.currentDir!.value + "/" + path;
      }
      return resolvePath(absPath);
    } else {
      return resolvePath(path);
    }
  }

  getEntry(path: string): { entry?: File; parent?: Dir; name?: string } {
    const ret: {
      entry?: File;
      parent?: Dir;
      name?: string;
    } = {};
    const comps = path.split("/");
    if (comps.length === 1) {
      ret.parent = this;
    }
    let entry;
    for (const [pos, comp] of comps.entries()) {
      if (!entry) {
        entry = this.entries.get(comp);
      } else if (entry instanceof Dir) {
        entry = entry.entries.get(comp);
      }
      if (pos === comps.length - 2) {
        if (entry instanceof Dir) {
          ret.parent = entry;
        }
      } else if (pos === comps.length - 1) {
        ret.entry = entry;
        ret.name = comp;
      }
      if (!entry) {
        break;
      }
    }
    return ret;
  }

  read(cookie: bigint = BigInt(0), maxBytes?: number) {
    const dirents = [];
    let nbytes = 0;
    for (const [name, ent] of this.entries.entries()) {
      const id = this.entryIDs.get(ent)!;
      if (cookie < id) {
        continue;
      }
      const dirent = new wasi.Dirent([
        id + BigInt(1),
        BigInt(0),
        name.length,
        ent instanceof Dir
          ? wasi.FILETYPE_DIRECTORY
          : wasi.FILETYPE_REGULAR_FILE,
      ]);
      dirent.name = name;
      dirents.push(dirent);
      nbytes += wasi.dirent_t.size + name.length;
      if (maxBytes != null && nbytes > maxBytes) {
        break;
      }
    }
    return dirents;
  }

  lookup(path: string, _lflags: number = 0): File {
    path = this.resolvePath(path);
    if (!path) {
      return this;
    } else {
      const { entry } = this.getEntry(path);
      if (entry) {
        return entry;
      } else {
        throw wasi.ERRNO_NOENT;
      }
    }
  }

  insert(path: string, newEntry: File) {
    path = this.resolvePath(path);
    const { parent, entry, name } = this.getEntry(path);
    if (entry) {
      throw wasi.ERRNO_EXIST;
    }
    if (!parent) {
      throw wasi.ERRNO_NOENT;
    }
    this.entries.set(name!, newEntry);
    this.entryIDs.set(newEntry, this.nextID++);
  }

  createDir(path: string) {
    this.insert(path, new Dir());
  }

  open(path: string, _lflags: number, oflags: number): File {
    path = this.resolvePath(path);

    if ((oflags & wasi.OFLAGS_DIRECTORY) !== 0) {
      if (!path) {
        return this;
      }
      const { entry } = this.getEntry(path);
      if (!entry) {
        throw wasi.ERRNO_NOENT;
      }
      if (entry instanceof RegularFile) {
        throw wasi.ERRNO_NOTDIR;
      }
      return entry;
    } else {
      let { entry, parent, name } = this.getEntry(path);
      if (!parent) {
        throw wasi.ERRNO_NOENT;
      }
      if (!path || entry instanceof Dir) {
        throw wasi.ERRNO_ISDIR;
      }
      if (
        entry &&
        (oflags & wasi.OFLAGS_CREAT) !== 0 &&
        (oflags & wasi.OFLAGS_EXCL) !== 0
      ) {
        throw wasi.ERRNO_EXIST;
      }
      if (!entry) {
        if ((oflags & wasi.OFLAGS_CREAT) === 0) {
          throw wasi.ERRNO_NOENT;
        }
        entry = new RegularFile();
        parent.insert(name!, entry!);
      }
      if ((oflags & wasi.OFLAGS_TRUNC) !== 0) {
        entry!.asRegularFile().truncate(0);
      }
      return entry!;
    }
  }

  removeDir(path: string) {
    path = this.resolvePath(path);
    const { parent, entry, name } = this.getEntry(path);
    if (!entry) {
      throw wasi.ERRNO_NOENT;
    }
    if (entry instanceof RegularFile) {
      throw wasi.ERRNO_NOTDIR;
    }
    const dir = entry.asDir();
    if (dir.entries.size !== 0) {
      throw wasi.ERRNO_NOTEMPTY;
    }
    if (dir.isPreopen) {
      throw wasi.ERRNO_NOTCAPABLE;
    }
    parent!.entries.delete(name!);
  }

  removeFile(path: string) {
    path = this.resolvePath(path);
    const { parent, entry, name } = this.getEntry(path);
    if (!entry) {
      throw wasi.ERRNO_NOENT;
    }
    if (entry instanceof Dir) {
      throw wasi.ERRNO_ISDIR;
    }
    parent!.entries.delete(name!);
  }

  rename(fromPath: string, toDir: Dir, toPath: string) {
    fromPath = this.resolvePath(fromPath);
    toPath = this.resolvePath(toPath);

    const ent = this.getEntry(fromPath);
    const toEnt = toDir.getEntry(toPath);

    if (!ent.entry || !toEnt.entry) {
      throw wasi.ERRNO_BADF;
    }

    ent.parent!.entries.delete(ent.name!);

    toEnt.parent!.entries.set(toEnt.name!, toEnt.entry!);
    toEnt.parent!.entryIDs.set(toEnt.entry!, toEnt.parent!.nextID++);
  }
}

function resolvePath(path: string): string {
  const parts = path ? path.split("/") : [];
  const resolvedParts = [];
  for (const item of parts) {
    if (item === "..") {
      if (resolvedParts.pop() === undefined) {
        throw wasi.ERRNO_NOTCAPABLE;
      }
    } else if (item && item !== ".") {
      resolvedParts.push(item);
    }
  }
  return resolvedParts.join("/");
}
