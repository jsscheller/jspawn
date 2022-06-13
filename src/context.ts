import { FDTable } from "./fdTable";
import { Memory } from "./memory";
import { RegularFile, Dir } from "./file";
import { Cell, isNode, ExitStatus } from "./utils";
import { snapshotPreview1 } from "./wasi/index";

export class Context {
  fdTable!: FDTable;
  mem!: Memory;
  envs!: string[];
  args!: string[];
  currentDir: Cell<string>;
  rootDir!: Dir;
  enc: TextEncoder;

  constructor() {
    this.currentDir = new Cell("/");

    const relPreopens: { [path: string]: Dir } = {};
    for (const path of ["", "..", "~"]) {
      const dir = new Dir({}, path, this.currentDir, true);
      if (!path) {
        this.rootDir = dir;
      }
      relPreopens[path] = dir;
    }

    if (!isNode()) {
      const stdio = [new RegularFile(), new RegularFile(), new RegularFile()];
      this.fdTable = new FDTable(stdio, relPreopens);
    }
    this.enc = new TextEncoder();
  }

  stringToBytes(s: string): Uint8Array {
    return this.enc.encode(s);
  }

  wasiImport(): any {
    const ctx = this;
    return Object.entries(snapshotPreview1).reduce(
      (acc: { [key: string]: any }, [key, val]) => {
        acc[key] = function () {
          const args = [ctx, ...arguments];
          try {
            // @ts-ignore
            val.apply(null, args);
            return 0;
          } catch (err) {
            if (typeof err === "number") {
              return err;
            } else {
              throw err;
            }
          }
        };
        return acc;
      },
      {}
    );
  }

  start(
    instance: WebAssembly.Instance,
    args: string[],
    envs: { [k: string]: string }
  ): number {
    this.mem = new Memory(instance);
    this.args = args;
    this.envs = Object.entries(envs).map(([key, val]) => {
      return `${key}=${val}`;
    });

    let exitCode = -1;
    try {
      // @ts-ignore
      exitCode = instance.exports["_start"]() || 0;
    } catch (err) {
      if (err instanceof ExitStatus) {
        exitCode = err.code;
      } else {
        throw err;
      }
    }
    return exitCode;
  }
}
