import { Memory } from "./memory";
import * as wasi from "./wasi/types";

export class IOVecs {
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
        const [iovecBufPtr, iovecBufLen] = wasi.iovec_t.get(mem!, ptr)
          .values as number[];
        this.bufs.push(
          mem!.u8.subarray(iovecBufPtr, iovecBufPtr + iovecBufLen)
        );
        ptr += wasi.iovec_t.size;
      }
    }
  }
}
