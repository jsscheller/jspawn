import { isNode, Deferred, loadNodeModule, requir } from "./utils";
import { FileSystem } from "./fileSystem";
import workerThreadRaw from "worker:./workerThread.ts";
import wasmBinary from "../dist/fs.wasm";

export const JSPAWN_WORKER_THREAD = "jspawnWorkerThread";
export const JSPAWN_PTHREAD = "jspawnPthread";

export async function subscribe(
  createMsg: (topic: number) => Message,
  handler: (msg: Message) => void
) {
  const worker = await getWorker();

  const topic = worker.channel.createTopic();
  worker.channel.send(createMsg(topic));
  await worker.channel.sub(topic, handler);

  WORKER_POOL!.reclaim(worker);

  if (isNode()) {
    worker.terminate();
  }
}

export async function request<T>(msg: Message, transfers?: any[]): Promise<T> {
  const worker = await getWorker();

  const ret = await worker.channel.req<T>(msg, transfers);

  WORKER_POOL!.reclaim(worker);

  if (isNode()) {
    worker.terminate();
  }

  return ret;
}

let WORKER_POOL: WorkerPool | undefined;

async function getWorker(): Promise<WorkerExt> {
  if (!WORKER_POOL) {
    let maxWorkers;
    if (isNode()) {
      maxWorkers = (await loadNodeModule("os"))["cpus"]().length;
    } else {
      maxWorkers = navigator.hardwareConcurrency || 2;
    }
    WORKER_POOL = new WorkerPool(maxWorkers);
  }
  return WORKER_POOL.next();
}

export function terminateWorkers() {
  if (WORKER_POOL) {
    for (const worker of WORKER_POOL!.workers) {
      worker.worker.terminateSync();
    }
  }
  WORKER_POOL = undefined;
}

type WorkerState = {
  worker: WorkerExt;
  idle?: boolean;
};

class WorkerPool {
  queue: Deferred<WorkerExt>[];
  workers: WorkerState[];
  maxWorkers: number;
  fsModule?: WebAssembly.Module;
  fsMemory?: WebAssembly.Memory;

  constructor(maxWorkers: number) {
    this.queue = [];
    this.workers = [];
    this.maxWorkers = maxWorkers;
  }

  next(): Promise<WorkerExt> {
    const def = new Deferred() as Deferred<WorkerExt>;
    this.queue.push(def);
    this.dequeue().catch(def.reject);
    return def.promise;
  }

  async dequeue() {
    if (this.queue.length === 0) return;
    const def = this.queue.shift()!;
    let worker = this.workers.find((worker: WorkerState) => worker.idle);
    if (!worker) {
      if (this.workers.length === this.maxWorkers) {
        return;
      } else {
        worker = { worker: await this.newWorker() } as WorkerState;
        this.workers.push(worker);
      }
    }
    worker.idle = false;
    clearTimeout(worker.worker.terminateTimeout);
    def!.resolve(worker.worker);
  }

  async newWorker(): Promise<WorkerExt> {
    if (!this.fsModule) {
      this.fsModule = await FileSystem.compile(wasmBinary);
      this.fsMemory = new WebAssembly.Memory({
        initial: 80,
        maximum: 16384,
        shared: true,
      });
    }

    const worker = await createWorker(JSPAWN_WORKER_THREAD);
    const workerExt = new WorkerExt(worker);
    workerExt.channel.send({
      type: MessageType.WorkerInit,
      fsModule: this.fsModule!,
      fsMemory: this.fsMemory!,
    });

    return workerExt;
  }

  reclaim(worker: WorkerExt) {
    const state = this.workers.find(
      (item: WorkerState) => item.worker === worker
    );
    state!.idle = true;
  }

  remove(worker: WorkerExt) {
    const pos = this.workers.findIndex(
      (item: WorkerState) => item.worker === worker
    );
    this.workers.splice(pos, 1);
  }
}

async function createWorker(id: string): Promise<Worker> {
  if (isNode()) {
    const worker_threads = await loadNodeModule("worker_threads");
    return createNodeWorker(id, "1", worker_threads);
  } else {
    return createWebWorker(id, "1");
  }
}

export function createWorkerSync(id: string, data: string): Worker {
  if (isNode()) {
    // @ts-ignore
    const worker_threads = requir("worker_threads");
    return createNodeWorker(id, data, worker_threads);
  } else {
    return createWebWorker(id, data);
  }
}

function createNodeWorker(
  id: string,
  data: string,
  worker_threads: any
): Worker {
  const worker = new worker_threads["Worker"](getWorkerJS(id, data), {
    ["eval"]: true,
  });
  return new NodeWorker(worker) as unknown as Worker;
}

function createWebWorker(id: string, data: any): Worker {
  // @ts-ignore
  let url = globalThis["WORKER_URL"];
  if (url) {
    if (url.includes("?")) {
      url += "&";
    } else {
      url += "?";
    }
    url += `${id}=${data}`;
    return new Worker(url);
  }
  const blob = new Blob([getWorkerJS(id, data)], {
    type: "application/javascript",
  });
  url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

function getWorkerJS(id: string, data: string): string {
  // @ts-ignore
  const js = workerThreadRaw || globalThis["WORKER_THREAD_RAW"];
  let header =
    `globalThis.WORKER_DATA = ${JSON.stringify({ [id]: data })};\n` +
    `globalThis.WORKER_THREAD_RAW = ${JSON.stringify(js)};\n`;
  if (!isNode()) {
    // @ts-ignore
    const origin = globalThis["ORIGIN"] || location.origin;
    header += `globalThis.ORIGIN = ${JSON.stringify(origin)};\n`;

    // @ts-ignore
    const url = globalThis["WORKER_URL"];
    if (url) header += `globalThis.WORKER_URL = ${JSON.stringify(url)};\n`;
  }
  return header + js;
}

class NodeWorker {
  worker: any;

  constructor(worker: any) {
    this.worker = worker;
  }

  ["addEventListener"](event: string, listener: any) {
    this.worker["on"](event, wrapNodeListener(listener));
  }

  ["postMessage"](msg: any, transfers?: any[]) {
    this.worker["postMessage"](msg, transfers);
  }

  ["terminate"]() {
    this.worker["terminate"]();
  }
}

function wrapNodeListener(listener: any): any {
  return function (data: any) {
    listener({ ["data"]: data });
  };
}

class WorkerExt {
  channel: ToWorkerChannel;
  terminateTimeout?: number;

  constructor(worker: Worker) {
    this.channel = new ToWorkerChannel(worker);
  }

  terminate() {
    clearTimeout(this.terminateTimeout);
    this.terminateTimeout = setTimeout(() => {
      this.terminateSync();
    }) as unknown as number;
  }

  terminateSync() {
    clearTimeout(this.terminateTimeout);
    WORKER_POOL!.remove(this);
    this.channel.worker.terminate();
  }
}

export type Message =
  | WorkerInit
  | SubprocessRun
  | SubprocessRunStdout
  | SubprocessRunStderr
  | SubprocessRunExitCode
  | SubprocessRunError
  | FSRequest
  | FSResponse;

export const enum MessageType {
  WorkerInit,
  SubprocessRun,
  SubprocessRunStdout,
  SubprocessRunStderr,
  SubprocessRunExitCode,
  SubprocessRunError,
  FSRequest,
  FSResponse,
}

export type WorkerInit = {
  type: MessageType.WorkerInit;
  fsModule: WebAssembly.Module;
  fsMemory: WebAssembly.Memory;
};

export type SubprocessRun = {
  type: MessageType.SubprocessRun;
  topic: number;
  program: string;
  args: string[];
  env: { [k: string]: string };
  wasmPath: string[];
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

export type SubprocessRunError = {
  type: MessageType.SubprocessRunError;
  message: string;
};

export const enum FSRequestType {
  WriteFile,
  ReadFileToBlob,
  Mkdir,
  Readdir,
  Rmdir,
  Mount,
  Chdir,
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

export type SerializedURL = {
  url: string;
};

class ToWorkerChannel {
  worker: Worker;
  nextId: number;
  subs: { [k: number]: Subscription };
  reqs: { [k: number]: Deferred<Message> };

  constructor(worker: Worker) {
    this.worker = worker;
    this.nextId = 1;
    this.subs = {};
    this.reqs = {};

    worker.addEventListener("message", this.onMessage.bind(this));
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
    return this.nextId++;
  }

  send(msg: Message, transfers?: any[]) {
    const toWorkerMsg: ToWorkerMessage = { msg };
    // @ts-ignore
    this.worker.postMessage(toWorkerMsg, transfers);
  }

  req<T>(msg: Message, transfers?: any[]): Promise<T> {
    const id = this.nextId++;
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

export class FromWorkerChannel {
  postMessage(msg: any) {
    if (isNode()) {
      // @ts-ignore
      requir("worker_threads")["parentPort"]["postMessage"](msg);
    } else {
      // @ts-ignore
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
