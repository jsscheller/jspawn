import { Memory } from "../memory";

interface Type<T> {
  size: number;
  align: number;
  get: (mem: Memory, ptr: number) => T;
  set: (mem: Memory, ptr: number, value: T) => void;
}

class PrimType<T> {
  _get: (ptr: number, le: boolean) => T;
  _set: (ptr: number, value: T, le: boolean) => void;
  size: number;
  align: number;

  constructor(name: string, size: number) {
    // @ts-ignore
    this._get = DataView.prototype[`get${name}`];
    // @ts-ignore
    this._set = DataView.prototype[`set${name}`];
    this.size = size;
    this.align = size;
  }

  get(mem: Memory, ptr: number): T {
    return this._get.call(mem.dv, ptr, true);
  }

  set(mem: Memory, ptr: number, value: T) {
    return this._set.call(mem.dv, ptr, value, true);
  }
}

class StructValue {
  values: (number | bigint | StructValue)[];

  constructor(values: (number | bigint | StructValue)[]) {
    this.values = values;
  }
}

class StructType<T extends StructValue> {
  ctor: new (values: (number | bigint | StructValue)[]) => T;
  fields: (Type<number> | Type<bigint> | Type<StructValue>)[];
  size: number;
  align: number;

  constructor(
    ctor: new (values: (number | bigint | StructValue)[]) => T,
    fields: (PrimType<number> | PrimType<bigint> | StructType<any>)[]
  ) {
    this.ctor = ctor;
    this.fields = [];
    let offset = 0;
    let structAlign = 0;
    for (const type of fields) {
      const fieldAlign = type.align;
      structAlign = Math.max(structAlign, fieldAlign);
      offset = alignTo(offset, fieldAlign);
      const fieldOffset = offset;
      this.fields.push({
        size: type.size,
        align: type.align,
        // @ts-ignore
        get(mem: Memory, ptr: number) {
          // @ts-ignore
          return type.get(mem, ptr + fieldOffset);
        },
        set(mem: Memory, ptr: number, value: any) {
          // @ts-ignore
          type.set(mem, ptr + fieldOffset, value);
        },
      });
      offset += type.size;
    }
    this.size = alignTo(offset, structAlign);
    this.align = structAlign;
  }

  get(mem: Memory, ptr: number): T {
    const values = [];
    for (const field of this.fields) {
      values.push(field.get(mem, ptr));
    }
    return new this.ctor(values);
  }

  set(mem: Memory, ptr: number, value: T, max?: number) {
    let nset = 0;
    for (const [pos, v] of value.values.entries()) {
      if (max != null && nset >= max) {
        break;
      }
      // @ts-ignore
      this.fields[pos].set(mem, ptr, v, max ? max - nset : undefined);
      nset += this.fields[pos].size;
    }
  }
}

function alignTo(ptr: number, align: number): number {
  let mismatch = ptr % align;
  if (mismatch) {
    ptr += align - mismatch;
  }
  return ptr;
}

class StringType {
  enc: TextEncoder;
  dec: TextDecoder;

  constructor() {
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
  }

  tryGet(mem: Memory, ptr: number, len: number): string | null {
    if (!ptr) {
      return null;
    } else {
      return this.get(mem, ptr, len);
    }
  }

  get(mem: Memory, ptr: number, len: number): string {
    return this.dec.decode(mem.u8.subarray(ptr, ptr + len));
  }

  getC(mem: Memory, ptr: number): string {
    const len = mem.u8.subarray(ptr).findIndex((v) => !v);
    return this.get(mem, ptr, len);
  }

  set(
    mem: Memory,
    ptr: number,
    value: string,
    len: number = value.length,
    nreadPtr?: number
  ) {
    const { read } = this.enc.encodeInto(
      value,
      mem.u8.subarray(ptr, ptr + len)
    );
    if (nreadPtr) {
      uint32_t.set(mem, nreadPtr, read!);
    }
  }
}

class CStringVecType {
  set(mem: Memory, ptr: number, bufPtr: number, v: string[]) {
    let acc = bufPtr;
    for (const [pos, s] of v.entries()) {
      mem.u32[(ptr + pos * 4) >> 2] = acc;
      string_t.set(mem, acc, s + "\0");
      acc += s.length + 1;
    }
  }

  setSizes(mem: Memory, cPtr: number, sizePtr: number, v: string[]) {
    size_t.set(mem, cPtr, v.length);

    const size = v.reduce((acc: number, s: string) => {
      return acc + s.length + 1;
    }, 0);
    size_t.set(mem, sizePtr, size);
  }
}

export class Filestat extends StructValue {
  get dev(): bigint {
    // @ts-ignore
    return this.values[0];
  }
  get ino(): bigint {
    // @ts-ignore
    return this.values[1];
  }
  get filetype(): number {
    // @ts-ignore
    return this.values[2];
  }
  get nlink(): bigint {
    // @ts-ignore
    return this.values[3];
  }
  get size(): bigint {
    // @ts-ignore
    return this.values[4];
  }
  get atim(): bigint {
    // @ts-ignore
    return this.values[5];
  }
  get mtim(): bigint {
    // @ts-ignore
    return this.values[6];
  }
  get ctim(): bigint {
    // @ts-ignore
    return this.values[7];
  }
}
export class Dirent extends StructValue {
  name!: string;

  get d_next(): bigint {
    // @ts-ignore
    return this.values[0];
  }
  get d_ino(): bigint {
    // @ts-ignore
    return this.values[1];
  }
  get d_namlen(): number {
    // @ts-ignore
    return this.values[2];
  }
  get d_type(): number {
    // @ts-ignore
    return this.values[3];
  }
}
export class Fdstat extends StructValue {
  get fs_filetype(): number {
    // @ts-ignore
    return this.values[0];
  }
  get fs_flags(): number {
    // @ts-ignore
    return this.values[1];
  }
  get fs_rights_base(): bigint {
    // @ts-ignore
    return this.values[2];
  }
  get fs_rights_inheriting(): bigint {
    // @ts-ignore
    return this.values[3];
  }
}
export class Prestat extends StructValue {
  get tag(): number {
    // @ts-ignore
    return this.values[0];
  }
  get pr_name_len(): number {
    // @ts-ignore
    return this.values[1];
  }
}
export class IOVec extends StructValue {
  get buf(): number {
    // @ts-ignore
    return this.values[0];
  }
  get buf_len(): number {
    // @ts-ignore
    return this.values[1];
  }
}

export const int8_t: PrimType<number> = new PrimType("Int8", 1);
export const uint8_t: PrimType<number> = new PrimType("Uint8", 1);
export const int16_t: PrimType<number> = new PrimType("Int16", 2);
export const uint16_t: PrimType<number> = new PrimType("Uint16", 2);
export const int32_t: PrimType<number> = new PrimType("Int32", 4);
export const uint32_t: PrimType<number> = new PrimType("Uint32", 4);
export const float32_t: PrimType<number> = new PrimType("Float32", 4);
export const float64_t: PrimType<number> = new PrimType("Float64", 4);
export const int64_t: PrimType<bigint> = new PrimType("BigInt64", 8);
export const uint64_t: PrimType<bigint> = new PrimType("BigUint64", 8);

export const size_t = uint32_t;
export const filesize_t = uint64_t;
export const fd_t = uint32_t;

export const string_t = new StringType();
export const cstringvec_t = new CStringVecType();

export const filestat_t = new StructType(Filestat, [
  uint64_t,
  uint64_t,
  uint8_t,
  uint64_t,
  uint64_t,
  uint64_t,
  uint64_t,
  uint64_t,
]);
export const dirent_t = new StructType(Dirent, [
  uint64_t,
  uint64_t,
  uint32_t,
  uint8_t,
]);
export const fdstat_t = new StructType(Fdstat, [
  uint8_t,
  uint16_t,
  uint64_t,
  uint64_t,
]);
export const prestat_t = new StructType(Prestat, [uint8_t, size_t]);
export const iovec_t = new StructType(IOVec, [uint32_t, size_t]);
