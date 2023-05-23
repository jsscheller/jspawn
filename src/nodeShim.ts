import { WasiFS, constants } from "./wasiFS";
import { unreachable, isNode, requir, absURL } from "./utils";
import { createWorkerSync, JSPAWN_PTHREAD } from "./worker";

export class NodeShim {
  process: any;
  require: any;
  Buffer: any;
  crypto: any;
  postMessage: any;
  importScripts: any;
  performance: any;
  self: any;
  Worker: any;
  wasmBuf?: any;
  jsPath?: string;
  isPthread?: boolean;
  createdWorker?: boolean;
  onExit?: (exitCode: number) => void;
  exitCode?: number;

  constructor(
    fs: WasiFS,
    fsModule: WebAssembly.Module,
    fsMemory: WebAssembly.Memory,
    isPthread?: boolean
  ) {
    this.isPthread = isPthread;
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
      // @ts-ignore
      ["exit"]: (exitCode: number) => {
        if (this.onExit) {
          this.onExit(exitCode);
        } else {
          this.exitCode = exitCode;
        }
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
    const path = isNode()
      ? // @ts-ignore
        requir("path")
      : {
          ["resolve"]: function (path: string): string {
            return path;
          },
          ["relative"]: function (a: string, b: string): string {
            return a + "/" + b;
          },
          ["dirname"]: function () {
            return "";
          },
        };

    const child_process = {
      ["spawnSync"]: function () {
        return { ["status"]: 1 };
      },
    };

    const that = this;
    this.Worker = function () {
      that.createdWorker = true;
      return new NodeWorker(that.jsPath!, fsModule, fsMemory);
    };
    const worker_threads = {
      ["Worker"]: this.Worker,
      ["parentPort"]: {
        ["on"]: function () {},
      },
    };

    const os = {
      ["cpus"]: function (): any[] {
        if (isNode()) {
          // @ts-ignore
          return requir("os").cpus();
        } else {
          const cpus = [];
          const cpuCount = navigator.hardwareConcurrency || 1;
          for (let i = 0; i < cpuCount; i++) {
            cpus.push({});
          }
          return cpus;
        }
      },
    };

    this.require = function (mod: string): any {
      switch (mod) {
        case "fs":
          return boundFs;
        case "path":
          return path;
        case "child_process":
          return child_process;
        case "worker_threads":
          return worker_threads;
        case "os":
          return os;
        default:
          throw `unexpected module: ${mod}`;
      }
    };

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

    if (isNode()) {
      const nodeCrypto = requir("crypto");
      this.crypto = {
        ["getRandomValues"](buf: Uint8Array) {
          buf.set(nodeCrypto["randomBytes"](buf.length));
          return buf;
        },
      };
      const parentPort = requir("worker_threads")["parentPort"];
      this.postMessage = parentPort["postMessage"].bind(parentPort);
    } else {
      this.crypto = crypto;
      this.postMessage = globalThis.postMessage;
    }

    // Assuming this only gets called once during pthread init.
    this.importScripts = () => {
      const path = this.jsPath!.replace(".worker.", ".");
      const exports = this.evalSync(path);
      for (const [key, val] of Object.entries(exports)) {
        // @ts-ignore
        globalThis[key] = val;
      }
    };

    this.performance = globalThis.performance || {
      ["now"]: () => Date.now(),
    };

    this.self = {};
  }

  async eval(path: string, wasmBuf?: any): Promise<any> {
    let js;
    if (isNode()) {
      // @ts-ignore
      const nodePath = requir("path");
      // @ts-ignore
      js = await requir("fs/promises")["readFile"](
        nodePath["isAbsolute"](path)
          ? path
          : nodePath["join"](process["cwd"](), path)
      );
      js = js.toString();
      this.wasmBuf = wasmBuf;
    } else {
      js = await (await fetch(absURL(path))).text();
    }
    this.jsPath = path;
    return this.evalImpl(js);
  }

  evalSync(path: string): any {
    let js;
    if (isNode()) {
      // @ts-ignore
      js = requir("fs")["readFileSync"](path);
    } else {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", absURL(path), false);
      xhr.responseType = "text";
      xhr.send();
      js = xhr.response;
    }
    return this.evalImpl(js);
  }

  evalImpl(js: string): any {
    const shims = {
      ["global"]: {},
      ["process"]: this.process,
      ["require"]: this.require,
      ["__dirname"]: "",
      ["__filename"]: "",
      ["Buffer"]: this.Buffer,
      ["crypto"]: this.crypto,
      ["importScripts"]: this.isPthread ? this.importScripts : null,
      ["performance"]: this.performance,
      ["self"]: this.self,
      ["postMessage"]: this.isPthread ? this.postMessage : null,
      ["Worker"]: this.Worker,
    };
    const shimKeys = Object.keys(shims).join();
    const func = new Function(
      // Set `module` to undefined so `exports` gets populated.
      `"use strict"; return function(${shimKeys}) { var module = undefined; var exports = {}; ${js} return exports; }`
    )();
    return func.apply(func, Object.values(shims));
  }
}

class NodeWorker {
  worker: Worker;

  constructor(
    jsPath: string,
    fsModule: WebAssembly.Module,
    fsMemory: WebAssembly.Memory
  ) {
    this.worker = createWorkerSync(
      JSPAWN_PTHREAD,
      jsPath.replace(/.js$/, ".worker.js")
    );
    this.worker.postMessage([fsModule, fsMemory]);
  }

  ["on"](name: string, listener: any) {
    if (name === "message") {
      this.worker.addEventListener(name, (e: MessageEvent) => listener(e.data));
    } else {
      // @ts-ignore
      this.worker.addEventListener(name, (_: MessageEvent) => {});
    }
  }

  ["postMessage"](msg: any) {
    this.worker.postMessage(msg);
  }

  ["terminate"]() {
    this.worker.terminate();
  }
}
