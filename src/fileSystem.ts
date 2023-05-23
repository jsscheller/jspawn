import {
  MessageType,
  FSRequestType,
  FSResponse,
  SerializedURL,
  WorkerPool,
} from "./worker";
import { isNode, isPlainObject, isURL, loadNodeModule } from "./utils";
import wasmBinary from "../dist/fs.wasm";

export type MountSource = string | Blob | Uint8Array | { [path: string]: any };

declare type WriteFileOptions = {
  transfer?: boolean;
};

declare type ReadFileToBlobOptions = {
  type?: string;
};

declare type RmdirOptions = {
  recursive?: boolean;
};

export class FileSystem {
  workerPool: WorkerPool;
  mod: WebAssembly.Module;
  mem: WebAssembly.Memory;

  constructor(
    workerPool: WorkerPool,
    mod: WebAssembly.Module,
    mem: WebAssembly.Memory
  ) {
    this.workerPool = workerPool;
    this.mod = mod;
    this.mem = mem;
  }

  static async instantiate(
    workerPool: WorkerPool,
    mountPoint?: string,
    mount?: MountSource
  ): Promise<FileSystem> {
    const mod = await WebAssembly.compile(wasmBinary);
    const mem = new WebAssembly.Memory({
      initial: 80,
      maximum: 16384,
      shared: true,
    });
    const fs = new FileSystem(workerPool, mod, mem);
    if (mountPoint && mount) {
      await fs.mount(mountPoint, mount);
    }
    return fs;
  }

  async mount(mountPoint: string, mount: MountSource) {
    if (isNode()) {
      mount = await resolveNodePaths(mount);
    }
    await unwrap<void>(
      this.workerPool.request<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Mount,
        args: [mount, mountPoint],
      })
    );
  }

  async writeFile(
    path: string,
    data: string | Uint8Array | Blob | URL,
    opts: WriteFileOptions = {}
  ) {
    const transfers =
      opts.transfer && data instanceof Uint8Array ? [data.buffer] : [];
    const serData =
      data instanceof URL ? ({ url: data.toString() } as SerializedURL) : data;
    await unwrap<void>(
      this.workerPool.request<FSResponse>(
        {
          type: MessageType.FSRequest,
          fsType: FSRequestType.WriteFile,
          args: [path, serData],
        },
        transfers
      ),
      { ["path"]: path }
    );
  }

  async readFileToBlob(
    path: string,
    opts: ReadFileToBlobOptions = {}
  ): Promise<Blob> {
    return unwrap<Blob>(
      this.workerPool.request<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.ReadFileToBlob,
        args: [path, opts.type],
      }),
      { ["path"]: path }
    );
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const blob = await this.readFileToBlob(path);
    return blob.arrayBuffer();
  }

  async mkdir(path: string) {
    await unwrap<void>(
      this.workerPool.request<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Mkdir,
        args: [path],
      }),
      { ["path"]: path }
    );
  }

  async readdir(path: string): Promise<string[]> {
    return unwrap<string[]>(
      this.workerPool.request<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Readdir,
        args: [path],
      }),
      { ["path"]: path }
    );
  }

  async rmdir(path: string, opts: RmdirOptions = {}) {
    await unwrap<void>(
      this.workerPool.request<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Rmdir,
        args: [path, opts.recursive],
      }),
      { ["path"]: path }
    );
  }
}

async function resolveNodePaths(source: MountSource): Promise<MountSource> {
  if (typeof source === "string" && !isURL(source)) {
    const nodePath = await loadNodeModule("path");
    let path = nodePath["resolve"](source);
    const nodeFS = await loadNodeModule("fs/promises");
    const stats = await nodeFS["stat"](path);
    if (!stats["isDirectory"]()) {
      path = "file://" + path;
    }
    return path;
  } else if (isPlainObject(source)) {
    const acc: { [k: string]: MountSource } = {};
    for (const [key, val] of Object.entries(source)) {
      acc[key] = await resolveNodePaths(val);
    }
    return acc;
  } else {
    return source;
  }
}

async function unwrap<T>(
  res: Promise<FSResponse>,
  errCtx: any = {}
): Promise<T> {
  const { ok, err } = await res;
  if (err) {
    const fsErr = new Error(err["code"] || "FSError");
    Object.assign(fsErr, err, errCtx);
    throw fsErr;
  } else {
    return ok as T;
  }
}
