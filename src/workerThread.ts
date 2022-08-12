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
} from "./worker";
import { resizeBuffer, isNode } from "./utils";
import { FileSystem } from "./fileSystem";
import * as wasi from "./wasi/index";

function main() {
  if (isWorkerThread()) {
    const thread = new WorkerThread();
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

function isWorkerThread(): boolean {
  if (isNode()) {
    try {
      // @ts-ignore
      const data = require("worker_threads")["workerData"];
      return data && data[JSPAWN_WORKER_THREAD];
    } catch (_) {
      return false;
    }
  } else {
    return location.search.includes(JSPAWN_WORKER_THREAD);
  }
}

class WorkerThread {
  channel: FromWorkerChannel;
  ctx: wasi.Context;
  nodeShim!: NodeShim;
  fs!: FileSystem;

  constructor() {
    this.channel = new FromWorkerChannel();
    this.ctx = new wasi.Context();
  }

  async onMessage(e: MessageEvent) {
    const msg = (isNode() ? e : e.data) as ToWorkerMessage;
    const data = msg.msg;

    switch (data.type) {
      case MessageType.WorkerInit: {
        const fs = await FileSystem.instantiate(data.fsModule, data.fsMemory);
        this.ctx.fs = this.fs = fs;
        // @ts-ignore
        const nodePath = isNode() ? require("path") : undefined;
        this.nodeShim = new NodeShim(fs.nodeFS(), nodePath);
        break;
      }
      case MessageType.SubprocessRun:
        await this.subprocessRun(data);
        break;
      case MessageType.FSRequest:
        await this.fsReqeust(msg.req!, data);
        break;
    }
  }

  async subprocessRun(msg: SubprocessRun) {
    let mod: WebAssembly.Module;
    const binaryPath = await resolveBinaryPath(msg.program, msg.wasmPath);
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
      const jsPath = binaryPath.replace(/wasm$/, "js");
      let js;
      if (isNode()) {
        // @ts-ignore
        const nodePath = require("path");
        // @ts-ignore
        js = await require("fs/promises")["readFile"](
          nodePath["isAbsolute"](jsPath)
            ? jsPath
            : nodePath["join"](process["cwd"](), jsPath)
        );
        this.nodeShim.wasmBuf = wasmBuf;
      } else {
        js = await (await fetch(jsPath)).text();
      }
      const func = new Function(
        `"use strict"; return function(process, require, __dirname, Buffer) { var importScripts; var exports = {}; ${js} return exports.Module; }`
      )();
      const Module = func(
        this.nodeShim.process,
        this.nodeShim.require,
        this.nodeShim.__dirname,
        this.nodeShim.Buffer
      );

      const stdinCallback = () => null;
      const stdoutCallback = stdout.push.bind(stdout);
      const stderrCallback = stderr.push.bind(stderr);

      // @ts-ignore
      const emMod = await Module({
        ["noInitialRun"]: true,
        ["noFSInit"]: true,
        ["locateFile"]: () => binaryPath,
        ["preRun"]: (mod: any) => {
          Object.assign(mod["ENV"], msg.env);
        },
      });

      emMod["FS"]["setIgnorePermissions"](true);
      emMod["FS"]["init"](stdinCallback, stdoutCallback, stderrCallback);
      const working = "/working";
      emMod["FS"]["mkdir"](working);
      emMod["FS"]["mount"](emMod["NODEFS"], { root: "." }, working);
      emMod["FS"]["chdir"](working);

      exitCode = emMod["callMain"](msg.args);
      if (exitCode == null) {
        const getExitStatus = emMod["exitStatus"];
        if (typeof getExitStatus === "function") {
          exitCode = getExitStatus();
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

type BinaryResolveCache = {
  wasmPath?: string[];
  resolutions: { [k: string]: string };
};

const BINARY_RESOLVE_CACHE: BinaryResolveCache = {
  resolutions: {},
};

async function resolveBinaryPath(
  program: string,
  wasmPath: string[]
): Promise<string | undefined> {
  let sep = "/";
  if (isNode()) {
    // @ts-ignore
    sep = require("path")["sep"];
  }
  const wasmExt = ".wasm";

  if (program.includes(sep) || program.endsWith(wasmExt)) {
    return program;
  }

  program += wasmExt;

  const cached = BINARY_RESOLVE_CACHE.resolutions[program];
  if (cached) {
    return cached;
  }

  if (isNode()) {
    // @ts-ignore
    const fs = require("fs/promises");
    // @ts-ignore
    const path = require("path");

    if (!BINARY_RESOLVE_CACHE.wasmPath) {
      const acc = [];
      const jspawnPath = path["join"]("node_modules", "@jspawn");
      let folders: string[] | undefined;
      try {
        folders = await fs["readdir"](jspawnPath);
      } catch (_) {}
      if (folders) {
        for (const folder of folders.filter((name) => name !== "jspawn")) {
          const folderPath = path["join"](jspawnPath, folder);
          for (const ent of await fs["readdir"](folderPath)) {
            acc.push(path["join"](folderPath, ent));
          }
        }
      }
      BINARY_RESOLVE_CACHE.wasmPath = acc;
    }

    for (const testPath of wasmPath.concat(BINARY_RESOLVE_CACHE.wasmPath)) {
      if (testPath.endsWith(sep + program)) {
        return (BINARY_RESOLVE_CACHE.resolutions[program] = testPath);
      }
    }
  } else {
    return wasmPath.find((path: string) => path.endsWith(sep + program));
  }

  return undefined;
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

main();
