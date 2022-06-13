import { isMainThread, isNode } from "./utils";

export type Message =
  | SubprocessRun
  | SubprocessRunStdout
  | SubprocessRunStderr
  | SubprocessRunExitCode
  | FSRequest
  | FSResponse;

export const enum MessageType {
  SubprocessRun,
  SubprocessRunStdout,
  SubprocessRunStderr,
  SubprocessRunExitCode,
  FSRequest,
  FSResponse,
}

export type SubprocessRun = {
  type: MessageType.SubprocessRun;
  topic: number;
  wasmBinary: string;
  args: string[];
  env: { [k: string]: string };
};

export type SubprocessRunStdout = {
  type: MessageType.SubprocessRunStdout;
  buf: Uint8Array;
};

export type SubprocessRunStderr = {
  type: MessageType.SubprocessRunStderr;
  buf: Uint8Array;
};

export type SubprocessRunExitCode = {
  type: MessageType.SubprocessRunExitCode;
  exitCode: number;
};

export const enum FSRequestType {
  WriteFile,
  ReadFileToBlob,
}

export type FSRequest = {
  type: MessageType.FSRequest;
  fsType: FSRequestType;
  args: any[];
};

export type FSResponse = {
  type: MessageType.FSResponse;
  ok?: any;
  err?: any;
};

export type ToWorkerMessage = {
  msg: Message;
  req?: number;
};

export type FromWorkerMessage = {
  msg: Message;
  topic?: number;
  topicEnd?: boolean;
  req?: number;
};

type Subscription = {
  deferred: Deferred<void>;
  callback: (msg: Message) => void;
};

let WORKER_PATH!: string;
if (isMainThread()) {
  // UMD/nodejs note:
  // Normally accessing `import.meta` doesn't work in non-modules.
  // However, it gets replaced with an equivalent value in the build step when targeting UMD.
  // @ts-ignore
  try {
    // @ts-ignore
    WORKER_PATH = import.meta.url;
  } catch (_) {
    // @ts-ignore
    WORKER_PATH = document.currentScript!.src;
  }
}

export class ToWorker {
  _worker?: Worker;
  nextID: number;
  subs: { [k: number]: Subscription };
  reqs: { [k: number]: Deferred<Message> };

  constructor() {
    this.nextID = 1;
    this.subs = {};
    this.reqs = {};
  }

  get worker(): Worker {
    if (!this._worker) {
      const WorkerCtor = isNode() ? NodeWorker : Worker;
      let isModule = true;
      try {
        import.meta;
      } catch (_) {
        isModule = false;
      }
      this._worker = new WorkerCtor(
        WORKER_PATH,
        isModule ? { type: "module" } : undefined
      ) as unknown as Worker;
      this._worker!.addEventListener("message", this.onMessage.bind(this));
    }
    return this._worker!;
  }

  terminateWorker() {
    if (this._worker) {
      this._worker.terminate();
    }
  }

  onMessage(e: MessageEvent) {
    const msg = e.data as FromWorkerMessage;
    if (msg.topic) {
      const sub = this.subs[msg.topic]!;
      sub.callback(msg.msg);
      if (msg.topicEnd) {
        delete this.subs[msg.topic];
        sub.deferred.resolve();
      }
    } else {
      const req = this.reqs[msg.req!];
      delete this.reqs[msg.req!];
      req.resolve(msg.msg);
    }
  }

  createTopic(): number {
    return this.nextID++;
  }

  send(msg: Message) {
    const toWorkerMsg: ToWorkerMessage = { msg };
    this.worker.postMessage(toWorkerMsg);
  }

  req<T>(msg: Message, transfers?: any[]): Promise<T> {
    const id = this.nextID++;
    const deferred: Deferred<Message> = new Deferred();
    this.reqs[id] = deferred;
    const toWorkerMsg: ToWorkerMessage = { msg, req: id };
    // @ts-ignore
    this.worker.postMessage(toWorkerMsg, transfers);
    return deferred.promise as unknown as Promise<T>;
  }

  sub(topic: number, callback: (msg: Message) => void): Promise<void> {
    const deferred: Deferred<void> = new Deferred();
    this.subs[topic] = {
      deferred,
      callback,
    };
    return deferred.promise;
  }
}

export class FromWorker {
  postMessage(msg: any) {
    if (isNode()) {
      // @ts-ignore
      require("worker_threads")["parentPort"]["postMessage"](msg);
    } else {
      postMessage(msg);
    }
  }

  res(req: number, msg: Message) {
    const fromWorkerMsg: FromWorkerMessage = {
      msg,
      req,
    };
    this.postMessage(fromWorkerMsg);
  }

  pub(topic: number, msg: Message, end: boolean = false) {
    const fromWorkerMsg: FromWorkerMessage = {
      msg,
      topic,
      topicEnd: end,
    };
    this.postMessage(fromWorkerMsg);
  }
}

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (t: T) => void;
  reject!: (err: any) => void;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class NodeWorker {
  worker: Deferred<any>;

  constructor(path: string, _: any) {
    this.worker = new Deferred();
    Promise.all([import("worker_threads"), import("path")]).then(
      (mods: any) => {
        // @ts-ignore
        const sep = mods[1]["sep"];
        path =
          path
            .replace(`file:${sep}${sep}`, "")
            .split(sep)
            .slice(0, -2)
            .join(sep) + `${sep}umd${sep}worker.cjs`;
        this.worker.resolve(new mods[0]["Worker"](path));
      }
    );
  }

  addEventListener(event: string, listener: any) {
    this.worker.promise.then((worker: any) =>
      worker["on"](event, wrapNodeListener(listener))
    );
  }

  postMessage(msg: any) {
    this.worker.promise.then((worker: any) => worker["postMessage"](msg));
  }

  terminate() {
    this.worker.promise.then((worker: any) => worker["terminate"]());
  }
}

function wrapNodeListener(listener: any): any {
  return function (data: any) {
    listener({ ["data"]: data });
  };
}

let _toWorker: ToWorker | undefined;
export function toWorker(): ToWorker {
  return _toWorker ? _toWorker : (_toWorker = new ToWorker());
}

export function terminateToWorker() {
  if (_toWorker) {
    _toWorker.terminateWorker();
  }
}
