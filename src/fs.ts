import {
  request,
  MessageType,
  FSRequestType,
  FSResponse,
  SerializedURL,
  terminateWorkers,
} from "./worker";
import { isNode, isPlainObject, isURL, loadNodeModule } from "./utils";

type MountSource = string | Blob | Uint8Array | { [path: string]: any };

export async function mount(source: MountSource, virtualPath: string) {
  if (isNode()) {
    source = await resolveNodePaths(source);
  }
  await unwrap<void>(
    request<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.Mount,
      args: [source, virtualPath],
    })
  );
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

export async function clear() {
  terminateWorkers();
}

declare type WriteFileOptions = {
  transfer?: boolean;
};

export async function writeFile(
  path: string,
  data: string | Uint8Array | Blob | URL,
  opts: WriteFileOptions = {}
) {
  const transfers =
    opts.transfer && data instanceof Uint8Array ? [data.buffer] : [];
  const serData =
    data instanceof URL ? ({ url: data.toString() } as SerializedURL) : data;
  await unwrap<void>(
    request<FSResponse>(
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

declare type ReadFileToBlobOptions = {
  type?: string;
};

export async function readFileToBlob(
  path: string,
  opts: ReadFileToBlobOptions = {}
): Promise<Blob> {
  return unwrap<Blob>(
    request<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.ReadFileToBlob,
      args: [path, opts.type],
    }),
    { ["path"]: path }
  );
}

export async function readFile(path: string): Promise<ArrayBuffer> {
  const blob = await readFileToBlob(path);
  return blob.arrayBuffer();
}

export async function mkdir(path: string) {
  await unwrap<void>(
    request<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.Mkdir,
      args: [path],
    }),
    { ["path"]: path }
  );
}

export async function readdir(path: string): Promise<string[]> {
  return unwrap<string[]>(
    request<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.Readdir,
      args: [path],
    }),
    { ["path"]: path }
  );
}

declare type RmdirOptions = {
  recursive?: boolean;
};

export async function rmdir(path: string, opts: RmdirOptions = {}) {
  await unwrap<void>(
    request<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.Rmdir,
      args: [path, opts.recursive],
    }),
    { ["path"]: path }
  );
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
