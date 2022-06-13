import { Dir, RegularFile, File } from "./file";
import * as wasi from "./wasi/index";
import { IOVecs } from "./ioVecs";

export class FDTable {
  nextFd: number;
  map: Map<number, Description>;

  constructor(stdio: File[], preopens: { [path: string]: File }) {
    this.nextFd = 0;
    this.map = new Map();
    for (const file of stdio) {
      this.push(file);
    }
    for (const [name, file] of Object.entries(preopens)) {
      this.push(file, name);
    }
  }

  get(fd: number): Description {
    const desc = this.map.get(fd);
    if (!desc) throw wasi.ERRNO_BADF;
    return desc;
  }

  getFile(fd: number): File {
    return this.get(fd).file;
  }

  getRegularFile(fd: number): RegularFile {
    return this.get(fd).file.asRegularFile();
  }

  getDir(fd: number): Dir {
    return this.get(fd).file.asDir();
  }

  remove(fd: number): Description {
    const desc = this.get(fd);
    this.map.delete(fd);
    return desc;
  }

  renumber(from: number, to: number) {
    const fromDesc = this.get(from);
    const toDesc = this.get(from);
    if (fromDesc.preopen || toDesc.preopen) {
      throw wasi.ERRNO_BADF;
    }
    this.map.set(from, toDesc);
    this.map.set(to, fromDesc);
  }

  push(file: File, preopen?: string) {
    this.map.set(this.nextFd, new Description(file, preopen));
    return this.nextFd++;
  }
}

class Description {
  pos: bigint;
  file: File;
  preopen?: string;

  constructor(file: File, preopen?: string) {
    this.pos = BigInt(0);
    this.file = file;
    this.preopen = preopen;
  }

  fdstat(): wasi.Fdstat {
    return new wasi.Fdstat([this.file.fileType(), 0, BigInt(0), BigInt(0)]);
  }

  read(iovs: IOVecs, offset?: bigint | number): number {
    const nread = this.file
      .asRegularFile()
      .read(iovs, offset != null ? offset : this.pos);
    if (offset == null) {
      this.pos += BigInt(nread);
    }
    return nread;
  }

  write(iovs: IOVecs, offset?: bigint | number): number {
    const nwritten = this.file.asRegularFile().write(iovs, offset);
    if (offset == null) {
      this.pos += BigInt(nwritten);
    }
    return nwritten;
  }

  prestat(): wasi.Prestat {
    if (this.preopen != null) {
      return new wasi.Prestat([0, this.preopen.length]);
    } else {
      throw wasi.ERRNO_BADF;
    }
  }

  prestatDirName(): string {
    if (this.preopen != null) {
      return this.preopen;
    } else {
      throw wasi.ERRNO_BADF;
    }
  }

  seek(offset: bigint, whence: number): bigint {
    const regFile = this.file.asRegularFile();

    let basePos;
    switch (whence) {
      case wasi.WHENCE_SET:
        basePos = BigInt(0);
        break;
      case wasi.WHENCE_END:
        basePos = BigInt(regFile.size);
        break;
      case wasi.WHENCE_CUR:
        basePos = this.pos;
        break;
      default:
        throw wasi.ERRNO_INVAL;
    }

    return (this.pos = basePos + offset);
  }
}
