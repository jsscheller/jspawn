import {
  toWorker as channel,
  MessageType,
  FSRequestType,
  FSResponse,
  SerializedURL,
} from "./workerChannel";
import { isNode } from "./utils";

declare type WriteFileOptions = {
  transfer?: boolean;
};

export async function writeFile(
  path: string,
  data: string | Uint8Array | Blob | URL,
  opts: WriteFileOptions = {}
): Promise<void> {
  if (isNode()) {
    await nodeFS((fs: any) => {
      // @ts-ignore
      return fs["writeFile"](path, data);
    });
  } else {
    const transfers =
      opts.transfer && data instanceof Uint8Array ? [data.buffer] : [];
    const serData =
      data instanceof URL ? ({ url: data.toString() } as SerializedURL) : data;
    unwrap<void>(
      channel().req<FSResponse>(
        {
          type: MessageType.FSRequest,
          fsType: FSRequestType.WriteFile,
          args: [path, serData],
        },
        transfers
      ),
      errorContext({ ["path"]: path })
    );
  }
}

declare type ReadFileToBlobOptions = {
  type?: string;
};

export async function readFileToBlob(
  path: string,
  opts: ReadFileToBlobOptions = {}
): Promise<Blob> {
  if (isNode()) {
    const buf = await nodeFS((fs: any) => {
      // @ts-ignore
      return fs["readFile"](path);
    });
    return nodeBuffer((buffer: any) => {
      // @ts-ignore
      return new buffer["Blob"]([buf], opts);
    });
  } else {
    return unwrap<Blob>(
      channel().req<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.ReadFileToBlob,
        args: [path, opts.type],
      }),
      errorContext({ ["path"]: path })
    );
  }
}

export async function mkdir(path: string): Promise<void> {
  if (isNode()) {
    await nodeFS((fs: any) => {
      // @ts-ignore
      return fs["mkdir"](path);
    });
  } else {
    return unwrap<void>(
      channel().req<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Mkdir,
        args: [path],
      }),
      errorContext({ ["path"]: path })
    );
  }
}

export async function readdir(path: string): Promise<string[]> {
  if (isNode()) {
    return nodeFS((fs: any) => {
      // @ts-ignore
      return fs["readdir"](path);
    });
  } else {
    return unwrap<string[]>(
      channel().req<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Readdir,
        args: [path],
      }),
      errorContext({ ["path"]: path })
    );
  }
}

declare type RmdirOptions = {
  recursive?: boolean;
};

export async function rmdir(
  path: string,
  opts: RmdirOptions = {}
): Promise<void> {
  if (isNode()) {
    return nodeFS((fs: any) => {
      // @ts-ignore
      return fs["rmdir"](path, opts);
    });
  } else {
    return unwrap<void>(
      channel().req<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.Rmdir,
        args: [path, opts.recursive],
      }),
      errorContext({ ["path"]: path })
    );
  }
}

function errorContext(other: any): any {
  return Object.assign({ ["stack"]: new Error().stack }, other);
}

async function unwrap<T>(res: Promise<FSResponse>, errCtx: any): Promise<T> {
  const { ok, err } = await res;
  if (err) {
    const fsErr = new Error(err["code"] || "FSError");
    Object.assign(fsErr, err, errCtx);
    throw fsErr;
  } else {
    return ok as T;
  }
}

function nodeFS<T>(cb: (fs: any) => Promise<T>): Promise<T> {
  return loadModule("fs/promises", cb);
}

function nodeBuffer<T>(cb: (buffer: any) => Promise<T>): Promise<T> {
  return loadModule("buffer", cb);
}

function loadModule<T>(name: string, cb: (x: any) => Promise<T>): Promise<T> {
  try {
    return import(name).then(cb);
  } catch (_) {
    // @ts-ignore
    const x = require(name);
    return cb(x);
  }
}
