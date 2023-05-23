import {
  Message,
  MessageType,
  FSRequestType,
  FSResponse,
  WorkerPool,
} from "./worker";
import { FileSystem, MountSource } from "./fileSystem";
import { isNode, loadNodeModule } from "./utils";

declare type InstantiateOptions = {
  fs?: { [path: string]: MountSource };
  binarySearchPath?: string[] | string;
};

declare type RunOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

declare type RunOptions = {
  env?: { [k: string]: string };
};

export class VirtualEnv {
  workerPool: WorkerPool;
  fs: FileSystem;
  binarySearchPath: string[];

  constructor(workerPool: WorkerPool, fs: FileSystem) {
    this.workerPool = workerPool;
    this.fs = fs;
    this.binarySearchPath = [];
  }

  static async instantiate(opts: InstantiateOptions = {}): Promise<VirtualEnv> {
    let maxWorkers;
    if (isNode()) {
      maxWorkers = (await loadNodeModule("os"))["cpus"]().length;
    } else {
      maxWorkers = navigator.hardwareConcurrency || 2;
    }
    const workerPool = new WorkerPool(maxWorkers);
    const fs = await FileSystem.instantiate(workerPool);
    workerPool.fs = fs;

    if (opts.fs) {
      await fs.mount(".", opts.fs);
    }

    const venv = new VirtualEnv(workerPool, fs);
    if (opts.binarySearchPath) {
      venv.setBinarySearchPath(opts.binarySearchPath);
    }
    return venv;
  }

  setBinarySearchPath(binarySearchPath: string[] | string) {
    this.binarySearchPath =
      typeof binarySearchPath === "string"
        ? [binarySearchPath]
        : binarySearchPath;
  }

  terminate() {
    this.workerPool.terminate();
  }

  async chdir(dir: string) {
    const { err } = await this.workerPool.request<FSResponse>({
      type: MessageType.FSRequest,
      fsType: FSRequestType.Chdir,
      args: [dir],
    });
    if (err) {
      throw new Error(err);
    }
  }

  async run(
    program: string,
    args: any[],
    opts: RunOptions = {}
  ): Promise<RunOutput> {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (typeof arg !== "string") {
        if (arg != null && typeof arg.toString === "function") {
          args[i] = arg.toString();
        } else {
          throw new TypeError(`invalid subprocess argument at index ${i}`);
        }
      }
    }

    let output = {
      stdout: "",
      stderr: "",
      exitCode: -1,
    };
    const decoder = new TextDecoder();
    let errMsg: string | undefined;

    await this.workerPool.subscribe(
      (topic: number) => ({
        type: MessageType.SubprocessRun,
        topic,
        program,
        args,
        env: opts.env || {},
        wasmPath: this.binarySearchPath,
      }),
      (msg: Message) => {
        switch (msg.type) {
          case MessageType.SubprocessRunStdout:
            if (output.stdout) output.stdout += "\n";
            output.stdout += decoder.decode(msg.buf);
            break;
          case MessageType.SubprocessRunStderr:
            if (output.stderr) output.stderr += "\n";
            output.stderr += decoder.decode(msg.buf);
            break;
          case MessageType.SubprocessRunExitCode:
            output.exitCode = msg.exitCode;
            break;
          case MessageType.SubprocessRunError:
            errMsg = msg.message;
            break;
        }
      }
    );

    if (errMsg) {
      throw new Error(errMsg);
    } else if (output.exitCode) {
      const err = new Error(
        `process exited with non-zero exit-code: ${program}`
      );
      Object.assign(err, output);
      throw err;
    }

    return output;
  }
}
