import { Memory } from "../memory";
import { FileSystem } from "../fileSystem";
import { ExitStatus } from "../utils";
import * as t from "./types";

export class Context {
  fs!: FileSystem;
  mem!: Memory;
  envs!: string[];
  args!: string[];

  bind(imports: any): any {
    const ctx = this;
    return Object.entries(imports).reduce(
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

  readPath(ptr: number, len: number): string {
    return t.string_t.get(this.mem, ptr, len);
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
