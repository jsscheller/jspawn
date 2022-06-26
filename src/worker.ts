import { NodeShim } from "./nodeShim";
import {
  FromWorker,
  ToWorkerMessage,
  MessageType,
  SubprocessRun,
  FSRequest,
  FSRequestType,
  fromWorker as channel,
  SerializedURL,
} from "./workerChannel";
import { Context } from "./context";
import { resizeBuffer, isNode, isMainThread } from "./utils";
import * as wasiFS from "./wasiFS";
import * as wasi from "./wasi/index";

// TODO: only add listener if this is THE worker thread.
if (!isMainThread()) {
  if (isNode()) {
    // @ts-ignore
    require("worker_threads")["parentPort"]["on"]("message", onMessage);
  } else {
    self.onmessage = onMessage;
  }
}

async function onMessage(e: MessageEvent) {
  const msg = (isNode() ? e : e.data) as ToWorkerMessage;
  await handleMessage(msg);
}

let CTX: Context;
let NODE_SHIM: NodeShim;
export async function handleMessage(msg: ToWorkerMessage) {
  if (!CTX) {
    CTX = new Context();
    NODE_SHIM = new NodeShim(CTX);
  }

  switch (msg.msg.type) {
    case MessageType.SubprocessRun:
      await subprocessRun(msg.msg, CTX, NODE_SHIM);
      break;
    case MessageType.FSRequest:
      await fsReqeust(msg.req!, msg.msg, CTX);
      break;
  }
}

async function subprocessRun(
  msg: SubprocessRun,
  ctx: Context,
  nodeShim: NodeShim
) {
  let mod: WebAssembly.Module;
  let binaryPath = msg.program;
  if (isNode()) {
    const resolvedBinaryPath = await resolveBinaryPath(
      msg.program,
      msg.wasmPath
    );
    if (!resolvedBinaryPath) {
      return channel().pub(
        msg.topic,
        {
          type: MessageType.SubprocessRunError,
          message: `unable to resolve WASM file for program: ${msg.program}`,
        },
        true
      );
    }
    binaryPath = resolvedBinaryPath;
    // @ts-ignore
    const buf = await require("fs/promises")["readFile"](binaryPath!);
    // @ts-ignore
    mod = await WebAssembly.compile(buf);
  } else {
    const src = await fetch(binaryPath);
    mod = await WebAssembly.compileStreaming(src);
  }

  const stdout = new Stdout((buf: Uint8Array) => {
    channel().pub(msg.topic, {
      type: MessageType.SubprocessRunStdout,
      buf,
    });
  });
  const stderr = new Stdout((buf: Uint8Array) => {
    channel().pub(msg.topic, {
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
    let Module: any;
    if (isNode()) {
      // @ts-ignore
      const nodePath = require("path");
      // @ts-ignore
      Module = require(nodePath["isAbsolute"](jsPath)
        ? jsPath
        : nodePath["join"](process["cwd"](), jsPath));
    } else {
      const js = await (await fetch(jsPath)).text();
      const func = new Function(
        `"use strict"; return function(process, require, __dirname, Buffer) { var importScripts; var exports = {}; ${js} return exports.Module; }`
      )();
      Module = func(
        nodeShim.process,
        nodeShim.require,
        nodeShim.__dirname,
        nodeShim.Buffer
      );
    }

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
  } else {
    const args = [msg.program].concat(msg.args);

    let wasiImport: any;
    let nodeWasi: any;
    if (isNode()) {
      // @ts-ignore
      const WASI = require("wasi")["WASI"];
      // @ts-ignore
      nodeWasi = new WASI({
        ["args"]: args,
        ["env"]: msg.env,
        ["preopens"]: {
          ".": ".",
        },
      });
      wasiImport = nodeWasi["wasiImport"];
    } else {
      wasiImport = ctx.wasiImport();
    }
    const importObject = { ["wasi_snapshot_preview1"]: wasiImport };
    const instance = await WebAssembly.instantiate(mod, importObject);
    if (isNode()) {
      // @ts-ignore
      exitCode = nodeWasi.start(instance);
    } else {
      exitCode = ctx.start(instance, args, msg.env);
    }
  }

  channel().pub(
    msg.topic,
    {
      type: MessageType.SubprocessRunExitCode,
      exitCode,
    },
    true
  );
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
  // @ts-ignore
  const path = require("path");
  const sep = path["sep"];
  const wasmExt = ".wasm";

  if (program.includes(sep) || program.endsWith(wasmExt)) {
    return program;
  }

  program += wasmExt;

  const cached = BINARY_RESOLVE_CACHE.resolutions[program];
  if (cached) {
    return cached;
  }

  // @ts-ignore
  const fs = require("fs/promises");

  if (!BINARY_RESOLVE_CACHE.wasmPath) {
    BINARY_RESOLVE_CACHE.wasmPath = [];

    const jspawnPath = path["join"]("node_modules", "@jspawn");
    let ents: string[] | undefined;
    try {
      ents = await fs["readdir"](jspawnPath);
    } catch (_) {}
    if (ents) {
      for (const ent of ents) {
        if (ent !== "jspawn") {
          BINARY_RESOLVE_CACHE.wasmPath!.push(path.join(jspawnPath, ent));
        }
      }
    }
  }

  const programWithoutExt = program.replace(wasmExt, "");
  for (const testPath of wasmPath.concat(BINARY_RESOLVE_CACHE.wasmPath)) {
    if (testPath.split(sep).pop()!.includes(programWithoutExt)) {
      try {
        const resolved = path["join"](testPath, program);
        await fs["stat"](resolved);
        return (BINARY_RESOLVE_CACHE.resolutions[program] = resolved);
      } catch (_) {}
    }
  }

  return undefined;
}

async function fsReqeust(req: number, msg: FSRequest, ctx: Context) {
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
        wasiFS.writeFileSync(
          ctx,
          msg.args[0] as string,
          data as Uint8Array | string | Blob | URL
        );
        break;
      }
      case FSRequestType.ReadFileToBlob:
        ok = wasiFS.readFileToBlobSync(ctx, msg.args[0] as string);
        break;
    }
  } catch (err) {
    if (typeof err === "number") {
      err = { ["code"]: "E" + wasi.errnoName(err) };
    }
    channel().res(req, {
      type: MessageType.FSResponse,
      err,
    });
    return;
  }
  channel().res(req, {
    type: MessageType.FSResponse,
    ok,
  });
}

class Stdout {
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
