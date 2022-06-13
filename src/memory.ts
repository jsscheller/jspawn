export class Memory {
  _dv?: DataView;
  _u8?: Uint8Array;
  _u32?: Uint32Array;
  src?: WebAssembly.Instance | ArrayBuffer;

  constructor(src?: WebAssembly.Instance | ArrayBuffer) {
    this.src = src;
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
    if (!this._dv || this._dv.buffer.byteLength === 0) {
      const src =
        this.src instanceof ArrayBuffer
          ? this.src
          : (this.src!.exports["memory"] as unknown as Uint8Array).buffer;
      this._dv = new DataView(src);
      this._u8 = new Uint8Array(src);
      this._u32 = new Uint32Array(src);
    }
  }
}
