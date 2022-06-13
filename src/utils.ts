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

export class Cell<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
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

export function isMainThread(): boolean {
  if (isNode()) {
    try {
      // @ts-ignore
      return require("worker_threads")["isMainThread"];
    } catch (_) {
      return true;
    }
  } else {
    return !!globalThis.document;
  }
}
