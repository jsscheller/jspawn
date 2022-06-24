import {
  toWorker as channel,
  MessageType,
  FSRequestType,
  FSResponse,
} from "./workerChannel";
import { isNode } from "./utils";

declare type WriteFileOptions = {
  transfer?: boolean;
};

export async function writeFile(
  path: string,
  data: string | Uint8Array | Blob,
  opts: WriteFileOptions = {}
): Promise<void> {
  if (isNode()) {
    // @ts-ignore
    nodeFS()["writeFile"](path, data);
  } else {
    const transfers =
      opts.transfer && data instanceof Uint8Array ? [data.buffer] : [];
    unwrap<void>(
      channel().req<FSResponse>(
        {
          type: MessageType.FSRequest,
          fsType: FSRequestType.WriteFile,
          args: [path, data],
        },
        transfers
      )
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
      })
    );
  }
}

async function unwrap<T>(res: Promise<FSResponse>): Promise<T> {
  const { ok, err } = await res;
  if (err) {
    throw err;
  } else {
    return ok as T;
  }
}

function nodeFS(): any {
  // @ts-ignore
  return require("fs/promises");
}
