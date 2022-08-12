export class Memory {
  _dv?: DataView;
  _u8?: Uint8Array;
  _u32?: Uint32Array;
  src: WebAssembly.Instance | WebAssembly.Memory;
  isShared: boolean;

  constructor(src: WebAssembly.Instance | WebAssembly.Memory) {
    this.src = src;
    this.isShared = src instanceof WebAssembly.Memory;
  }

  get dv() {
    this.refreshMemory();
    return this._dv!;
  }

  get u8() {
    this.refreshMemory();
    return this._u8!;
  }

  get u32() {
    this.refreshMemory();
    return this._u32!;
  }

  refreshMemory() {
    if (
      !this._dv ||
      this._dv.buffer.byteLength === 0 ||
      (this.isShared &&
        (this.src as WebAssembly.Memory).buffer.byteLength !== this._u8!.length)
    ) {
      const src =
        this.src instanceof WebAssembly.Instance
          ? (this.src.exports["memory"] as unknown as Uint8Array).buffer
          : this.src.buffer;
      this._dv = new DataView(src);
      this._u8 = new Uint8Array(src);
      this._u32 = new Uint32Array(src);
    }
  }
}
