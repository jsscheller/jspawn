import { Context } from "./context";
import * as wasiFS from "./wasiFS";
import * as wasi from "./wasi/index";

export class NodeShim {
  process: any;
  require: any;
  __dirname: any;
  Buffer: any;

  constructor(ctx: Context) {
    this.process = {
      // @ts-ignore
      ["versions"]: {
        ["node"]: "",
      },
      // @ts-ignore
      ["platform"]: "",
      // @ts-ignore
      ["argv"]: [],
      // @ts-ignore
      ["on"]() {},
      // @ts-ignore
      ["binding"](name: string) {
        if (name === "constants") {
          return wasiFS.constants;
        } else {
          return {};
        }
      },
      // @ts-ignore
      ["hrtime"]() {
        return [0, 0];
      },
    };

    const fs = {
      ["readSync"]: wasiFS.readSync,
      ["writeSync"]: wasiFS.writeSync,
      ["fstatSync"]: wasiFS.fstatSync,
      ["openSync"]: wasiFS.openSync,
      ["closeSync"]: wasiFS.closeSync,
      ["readlinkSync"]: wasiFS.readlinkSync,
      ["symlinkSync"]: wasiFS.symlinkSync,
      ["readdirSync"]: wasiFS.readdirSync,
      ["rmdirSync"]: wasiFS.rmdirSync,
      ["unlinkSync"]: wasiFS.unlinkSync,
      ["renameSync"]: wasiFS.renameSync,
      ["writeFileSync"]: wasiFS.writeFileSync,
      ["mkdirSync"]: wasiFS.mkdirSync,
      ["truncateSync"]: wasiFS.truncateSync,
      ["utimesSync"]: wasiFS.utimesSync,
      ["chmodSync"]: wasiFS.chmodSync,
      ["lstatSync"]: wasiFS.lstatSync,
    };
    const boundFs = Object.entries(fs).reduce(
      (acc: { [key: string]: any }, [key, val]) => {
        acc[key] = function () {
          try {
            // @ts-ignore
            return val.apply(null, [ctx, ...arguments]);
          } catch (err) {
            if (typeof err === "number") {
              throw { ["code"]: "E" + wasi.errnoName(err) };
            } else {
              throw err;
            }
          }
        };
        return acc;
      },
      {}
    );

    // This is used in the `readlink` function.
    // TODO: test to determine if this is sufficient.
    const path = {
      ["resolve"]: function (path: string): string {
        return path;
      },
      ["relative"]: function (a: string, b: string): string {
        return a + "/" + b;
      },
    };

    this.require = function (mod: string) {
      switch (mod) {
        case "fs":
          return boundFs;
        case "path":
          return path;
        default:
          throw `unexpected module: ${mod}`;
      }
    };

    this.__dirname = "";

    this.Buffer = {
      ["from"](buf: any) {
        return buf;
      },
    };
  }
}
