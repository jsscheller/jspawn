import {
  toWorker as channel,
  MessageType,
  FSRequestType,
  FSResponse,
} from "./workerChannel";

declare type WriteFileOptions = {
  transfer?: boolean;
};

export async function writeFile(
  path: string,
  data: string | Uint8Array | Blob,
  opts: WriteFileOptions = {}
): Promise<void> {
  const transfers =
    opts.transfer && data instanceof Uint8Array ? [data.buffer] : [];
  return unwrap<void>(
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

export async function readFileToBlob(path: string): Promise<Blob> {
  return unwrap<Blob>(
    channel().req<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.ReadFileToBlob,
      args: [path],
    })
  );
}

async function unwrap<T>(res: Promise<FSResponse>): Promise<T> {
  const { ok, err } = await res;
  if (err) {
    throw err;
  } else {
    return ok as T;
  }
}
