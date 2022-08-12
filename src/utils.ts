// Allocates a new backing store for the given node so that it can fit at least newSize amount of bytes.
// May allocate more, to provide automatic geometric increase and amortized linear performance appending writes.
// Never shrinks the storage.
export function resizeBuffer(
  buf: Uint8Array,
  newCapacity: number,
  prevLen: number = buf.length
): Uint8Array {
  const prevCapacity = buf ? buf.length : 0;
  if (prevCapacity >= newCapacity) {
    // No need to expand, the storage was already large enough.
    return buf;
  }
  // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
  // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
  // avoid overshooting the allocation cap by a very large margin.
  const CAPACITY_DOUBLING_MAX = 1024 * 1024;
  newCapacity = Math.max(
    newCapacity,
    (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) >>> 0
  );
  if (prevCapacity !== 0) {
    // At minimum allocate 256b for each file when expanding.
    newCapacity = Math.max(newCapacity, 256);
  }
  const prevBuf = buf;
  buf = new Uint8Array(newCapacity);
  if (prevLen > 0) {
    // Copy old data over to the new storage.
    buf!.set(prevBuf!.subarray(0, prevLen));
  }
  return buf;
}

export class ExitStatus extends Error {
  code: number;

  constructor(code: number) {
    super();
    this.code = code;
  }
}

export function unreachable(): never {
  throw new Error("unreachable");
}

export function isNode(): boolean {
  // @ts-ignore
  return !!globalThis["process"];
}

export class Deferred<T> {
  promise: Promise<T>;
  resolve!: (t: T) => void;
  reject!: (err: any) => void;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export function isPlainObject(x: any): boolean {
  try {
    return Object.getPrototypeOf(x) === Object.prototype;
  } catch (_) {
    return false;
  }
}

export function isURL(x: any): boolean {
  try {
    new URL(x);
    return true;
  } catch (_) {
    return false;
  }
}

export async function loadNodeModule(name: string): Promise<any> {
  try {
    return await import(name);
  } catch (_) {
    // @ts-ignore
    return require(name);
  }
}
