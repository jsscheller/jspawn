import { FileSystem, constants } from "./fileSystem";
import { unreachable } from "./utils";

export class NodeShim {
  process: any;
  require: any;
  __dirname: any;
  Buffer: any;
  wasmBuf?: any;

  constructor(fs: FileSystem, nodePath?: any) {
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
          return constants;
        } else {
          return {};
        }
      },
      // @ts-ignore
      ["hrtime"]() {
        return [0, 0];
      },
    };

    const fsMethods = {
      ["readSync"]: fs.readSync,
      ["writeSync"]: fs.writeSync,
      ["fstatSync"]: fs.fstatSync,
      ["openSync"]: fs.openSync,
      ["closeSync"]: fs.closeSync,
      ["readlinkSync"]: fs.readlinkSync,
      ["symlinkSync"]: fs.symlinkSync,
      ["readdirSync"]: fs.readdirSync,
      ["rmdirSync"]: fs.rmdirSync,
      ["unlinkSync"]: fs.unlinkSync,
      ["renameSync"]: fs.renameSync,
      ["writeFileSync"]: fs.writeFileSync,
      ["mkdirSync"]: fs.mkdirSync,
      ["truncateSync"]: fs.truncateSync,
      ["utimesSync"]: fs.utimesSync,
      ["chmodSync"]: fs.chmodSync,
      ["lstatSync"]: fs.lstatSync,
      ["readFileSync"]: () => {
        const buf = this.wasmBuf;
        delete this.wasmBuf;
        if (!buf) unreachable();
        return buf;
      },
    };
    const boundFs = Object.entries(fsMethods).reduce(
      (acc: { [key: string]: any }, [key, val]) => {
        acc[key] = val.bind(fs);
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

    const child_process = {
      ["spawnSync"]: function () {
        return { ["status"]: 1 };
      },
    };

    this.require = function (mod: string): any {
      switch (mod) {
        case "fs":
          return boundFs;
        case "path":
          return nodePath || path;
        case "child_process":
          return child_process;
        default:
          throw `unexpected module: ${mod}`;
      }
    };

    this.__dirname = "";

    this.Buffer = {
      // We need alloc so `Buffer.from` is called:
      // `return Buffer["alloc"] ? Buffer.from(arrayBuffer) : new Buffer(arrayBuffer);`
      ["alloc"]() {
        unreachable();
      },
      ["from"](buf: any) {
        return buf;
      },
    };

    // `instantiateStreaming` is required or else emscripten tries reading from the filesystem.
    if (!WebAssembly.instantiateStreaming) {
      WebAssembly.instantiateStreaming = async function (
        src: PromiseLike<Response> | Response,
        imports: any
      ): Promise<any> {
        if ((src as PromiseLike<Response>).then) {
          src = await src;
        }
        const abuf = await (src as Response).arrayBuffer();
        return WebAssembly.instantiate(abuf, imports);
      };
    }
  }
}
