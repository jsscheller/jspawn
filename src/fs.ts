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
    // @ts-ignore
    nodeFS()["writeFile"](path, data);
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

export async function readFileToBlob(path: string): Promise<Blob> {
  if (isNode()) {
    // @ts-ignore
    const buf = await nodeFS()["readFile"](path);
    // @ts-ignore
    return new (require("buffer")["Blob"])([buf]);
  } else {
    return unwrap<Blob>(
      channel().req<FSResponse>({
        type: MessageType.FSRequest,
        fsType: FSRequestType.ReadFileToBlob,
        args: [path],
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

function nodeFS(): any {
  // @ts-ignore
  return require("fs/promises");
}
