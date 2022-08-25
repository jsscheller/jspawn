import { NodeShim } from "./nodeShim";
import {
  ToWorkerMessage,
  MessageType,
  SubprocessRun,
  FSRequest,
  FSRequestType,
  FromWorkerChannel,
  SerializedURL,
  JSPAWN_WORKER_THREAD,
  JSPAWN_PTHREAD,
} from "./worker";
import { resizeBuffer, isNode, Deferred } from "./utils";
import { FileSystem } from "./fileSystem";
import * as wasi from "./wasi/index";

function main() {
  const isWorkerThread = !!getWorkerData(JSPAWN_WORKER_THREAD);
  const isPthread = !!getWorkerData(JSPAWN_PTHREAD);
  if (isWorkerThread || isPthread) {
    const thread = isPthread ? new Pthread() : new WorkerThread();
    const onMessage = thread.onMessage.bind(thread);
    if (isNode()) {
      // @ts-ignore
      globalThis.Blob = require("buffer")["Blob"];
      // @ts-ignore
      require("worker_threads")["parentPort"]["on"]("message", onMessage);
    } else {
      self.onmessage = onMessage;
    }
  }
}

class WorkerThread {
  channel: FromWorkerChannel;
  ctx: wasi.Context;
  fs!: FileSystem;
  fsModule!: WebAssembly.Module;
  fsMemory!: WebAssembly.Memory;
  binaryCache: {
    wasmPath?: string[];
    resolutions: { [k: string]: string };
  };
  queue: ToWorkerMessage[];

  constructor() {
    this.channel = new FromWorkerChannel();
    this.ctx = new wasi.Context();
    this.binaryCache = { resolutions: {} };
    this.queue = [];
  }

  async onMessage(e: MessageEvent) {
    const msg = (isNode() ? e : e.data) as ToWorkerMessage;
    const data = msg.msg;

    if (data.type === MessageType.WorkerInit) {
      const fs = await FileSystem.instantiate(data.fsModule, data.fsMemory);
      this.ctx.fs = this.fs = fs;
      this.fsModule = data.fsModule;
      this.fsMemory = data.fsMemory;

      for (const msg of this.queue.splice(0, this.queue.length)) {
        await this.handleMessage(msg);
      }
    } else if (!this.fs) {
      this.queue.push(msg);
    } else {
      this.handleMessage(msg);
    }
  }

  async handleMessage(msg: ToWorkerMessage) {
    switch (msg.msg.type) {
      case MessageType.SubprocessRun:
        await this.subprocessRun(msg.msg);
        break;
      case MessageType.FSRequest:
        await this.fsReqeust(msg.req!, msg.msg);
        break;
    }
  }

  async subprocessRun(msg: SubprocessRun) {
    let mod: WebAssembly.Module;
    const binaryPath = await this.resolveBinaryPath(msg.program, msg.wasmPath);
    if (!binaryPath) {
      return this.channel.pub(
        msg.topic,
        {
          type: MessageType.SubprocessRunError,
          message: `unable to resolve WASM file for program: ${msg.program}`,
        },
        true
      );
    }
    let wasmBuf;
    if (isNode()) {
      // @ts-ignore
      wasmBuf = await require("fs/promises")["readFile"](binaryPath!);
      // @ts-ignore
      mod = await WebAssembly.compile(wasmBuf);
    } else {
      const src = await fetch(binaryPath);
      if (WebAssembly.compileStreaming) {
        mod = await WebAssembly.compileStreaming(src);
      } else {
        mod = await WebAssembly.compile(await src.arrayBuffer());
      }
    }

    const stdout = new LineOut((buf: Uint8Array) => {
      this.channel.pub(msg.topic, {
        type: MessageType.SubprocessRunStdout,
        buf,
      });
    });
    const stderr = new LineOut((buf: Uint8Array) => {
      this.channel.pub(msg.topic, {
        type: MessageType.SubprocessRunStderr,
        buf,
      });
    });
    let exitCode;

    if (
      !WebAssembly.Module.exports(mod).find(
        (exp) => exp.name === "_start" || exp.name === "_initialize"
      )
    ) {
      // Assuming this is Emscripten if no WASI exports are found.
      const nodeShim = new NodeShim(
        this.fs.nodeFS(),
        this.fsModule,
        this.fsMemory
      );
      const jsPath = binaryPath.replace(/wasm$/, "js");
      const exports = await nodeShim.eval(jsPath, wasmBuf);
      const Module = Object.values(exports)[0]!;

      const stdinCallback = () => null;
      const stdoutCallback = stdout.push.bind(stdout);
      const stderrCallback = stderr.push.bind(stderr);

      // @ts-ignore
      const emMod = await Module({
        ["noInitialRun"]: true,
        ["noExitRuntime"]: false,
        ["noFSInit"]: true,
        ["locateFile"]: () => binaryPath,
        ["preRun"]: (mod: any) => {
          Object.assign(mod["ENV"], msg.env);
        },
        ["instantiateWasm"]: async (imports: any, cb: any) => {
          delete nodeShim.wasmBuf;
          const instance = await WebAssembly.instantiate(mod, imports);
          cb(instance, mod);
          return {};
        },
      });

      emMod["FS"]["setIgnorePermissions"](true);
      emMod["FS"]["init"](stdinCallback, stdoutCallback, stderrCallback);
      let working = "/working";
      emMod["FS"]["mkdir"](working);
      emMod["FS"]["mount"](emMod["NODEFS"], { root: "." }, working);
      const currentDir = this.fs.cwd();
      for (const comp of currentDir.split("/")) {
        if (comp) {
          working += "/~/~";
        }
      }
      emMod["FS"]["chdir"](working);

      exitCode = emMod["callMain"](msg.args);
      if (nodeShim.createdWorker) {
        const deferred = new Deferred();
        nodeShim.onExit = (exitCode_: number) => {
          exitCode = exitCode_;
          deferred.resolve(0);
        };
        await deferred.promise;
      }
      if (exitCode == null) {
        if (nodeShim.exitCode != null) {
          exitCode = nodeShim.exitCode;
        } else {
          const getExitStatus = emMod["exitStatus"];
          if (typeof getExitStatus === "function") {
            exitCode = getExitStatus();
          }
        }
      }
    } else {
      const args = [msg.program].concat(msg.args);
      const importObject = {
        ["wasi_snapshot_preview1"]: this.ctx.bind(wasi.snapshotPreview1),
      };
      const instance = await WebAssembly.instantiate(mod, importObject);
      exitCode = this.ctx.start(instance, args, msg.env);
    }

    this.channel.pub(
      msg.topic,
      {
        type: MessageType.SubprocessRunExitCode,
        exitCode,
      },
      true
    );
  }

  // In the browser, this assumes the mounted file system can be accessed via network.
  // TODO: it should be possible to do without that assumption.
  async resolveBinaryPath(
    program: string,
    wasmPath: string[]
  ): Promise<string | undefined> {
    const sep = pathSep();
    const wasmExt = ".wasm";

    if (program.includes(sep) || program.endsWith(wasmExt)) {
      return program;
    }

    program += wasmExt;

    const cached = this.binaryCache.resolutions[program];
    if (cached) return cached;

    const resolvedPath = wasmPath.find((path: string) =>
      path.endsWith(sep + program)
    );
    if (resolvedPath) return resolvedPath;

    if (!this.binaryCache.wasmPath) {
      const accPath = (readdir: any) => {
        const join = (a: string, b: string) => {
          return a + sep + b;
        };
        const acc = [];
        const jspawnPath = join("node_modules", "@jspawn");
        let folders: string[] | undefined;
        try {
          folders = readdir(jspawnPath);
        } catch (_) {}
        if (folders) {
          for (const folder of folders.filter(
            (name: string) => name !== "jspawn"
          )) {
            const folderPath = join(jspawnPath, folder);
            for (const ent of readdir(folderPath).filter((name: string) =>
              name.endsWith(wasmExt)
            )) {
              let resolvedPath = join(folderPath, ent);
              if (!isNode()) resolvedPath = "/" + resolvedPath;
              acc.push(resolvedPath);
            }
          }
        }
        return acc;
      };

      let readdir;
      if (isNode()) {
        // @ts-ignore
        const fs = require("fs");
        readdir = fs["readdirSync"];
      } else {
        readdir = this.fs.readdirSync.bind(this.fs);
      }

      this.binaryCache.wasmPath = accPath(readdir);
    }

    for (const testPath of this.binaryCache.wasmPath) {
      if (testPath.endsWith(sep + program)) {
        return (this.binaryCache.resolutions[program] = testPath);
      }
    }

    return undefined;
  }

  async fsReqeust(req: number, msg: FSRequest) {
    let ok;
    try {
      switch (msg.fsType) {
        case FSRequestType.WriteFile: {
          let data = msg.args[1] as
            | Uint8Array
            | string
            | Blob
            | SerializedURL
            | URL;
          const url = (data as SerializedURL).url;
          if (url) {
            data = new URL(url);
          }
          this.fs.writeFileSync(
            msg.args[0],
            data as Uint8Array | string | Blob | URL
          );
          break;
        }
        case FSRequestType.ReadFileToBlob:
          ok = await this.fs.readFileToBlob(
            msg.args[0],
            msg.args[1] as string | undefined
          );
          break;
        case FSRequestType.Mkdir:
          ok = this.fs.mkdirSync(msg.args[0]);
          break;
        case FSRequestType.Readdir:
          ok = this.fs.readdirSync(msg.args[0]);
          break;
        case FSRequestType.Rmdir:
          ok = this.fs.rmdirSync(msg.args[0], {
            recursive: msg.args[1] as boolean,
          });
          break;
        case FSRequestType.Mount:
          ok = this.fs.mount(msg.args[0], msg.args[1]);
          break;
        case FSRequestType.Chdir:
          ok = this.fs.chdir(msg.args[0]);
          break;
      }
    } catch (err) {
      if (typeof err === "number") {
        err = { ["code"]: "E" + wasi.errnoName(err) };
      } else {
        console.error(err);
      }
      this.channel.res(req, {
        type: MessageType.FSResponse,
        err,
      });
      return;
    }
    this.channel.res(req, {
      type: MessageType.FSResponse,
      ok,
    });
  }
}

function pathSep(): string {
  let sep = "/";
  if (isNode()) {
    // @ts-ignore
    sep = require("path")["sep"];
  }
  return sep;
}

class LineOut {
  callback: (buf: Uint8Array) => void;
  len: number;
  buf: Uint8Array;

  constructor(callback: (buf: Uint8Array) => void) {
    this.callback = callback;
    this.len = 0;
    this.buf = new Uint8Array(256);
  }

  push(charCode: number) {
    if (this.buf.length === this.len) {
      this.buf = resizeBuffer(this.buf, this.len * 2);
    }
    this.buf[this.len] = charCode;

    if (charCode === 10) {
      this.callback(this.buf.subarray(0, this.len));
      this.len = 0;
    } else {
      this.len += 1;
    }
  }
}

class Pthread {
  nodeShim!: NodeShim;
  queue: any[];
  init?: boolean;

  constructor() {
    this.queue = [];
  }

  async onMessage(e: MessageEvent) {
    const data = (isNode() ? e : e.data) as any;

    if (Array.isArray(data)) {
      const [fsModule, fsMemory] = data;
      const fs = await FileSystem.instantiate(fsModule, fsMemory);
      this.nodeShim = new NodeShim(fs.nodeFS(), fsModule, fsMemory, true);

      const workerPath = getWorkerData(JSPAWN_PTHREAD) as string;
      await this.nodeShim.eval(workerPath);

      for (const data of this.queue.splice(0, this.queue.length)) {
        this.handleMessage(data);
      }

      this.init = true;
    } else {
      if (this.init) {
        this.handleMessage(data);
      } else {
        this.queue.push(data);
      }
    }
  }

  handleMessage(data: any) {
    this.nodeShim.self["onmessage"]({ ["data"]: data });
  }
}

function getWorkerData(key: string): any {
  if (isNode()) {
    try {
      // @ts-ignore
      const data = require("worker_threads")["workerData"];
      return data && data[key];
    } catch (_) {
      return undefined;
    }
  } else {
    return new URL(location.href).searchParams.get(key);
  }
}

main();
