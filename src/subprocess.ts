import { toWorker, ToWorker, Message, MessageType } from "./workerChannel";
import { isNode } from "./utils";

let WASM_PATH: string[] = [];

export function setBinarySearchPath(path: string[] | string) {
  WASM_PATH = typeof path === "string" ? [path] : path;
}

declare type Options = {
  env?: { [k: string]: string };
};

declare type Output = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function run(
  program: string,
  args: string[],
  opts: Options = {}
): Promise<Output> {
  // Cache the worker in the browser so our virtual FS persists.
  // Terminate in nodejs so we don't hang the process.
  const channel: ToWorker = isNode() ? new ToWorker() : toWorker();

  const topic = channel.createTopic();
  channel.send({
    type: MessageType.SubprocessRun,
    topic,
    program,
    args,
    env: opts.env || {},
    wasmPath: WASM_PATH,
  });
  let output = {
    stdout: "",
    stderr: "",
    exitCode: -1,
  };
  const decoder = new TextDecoder();
  let errMsg: string | undefined;
  await channel.sub(topic, (msg: Message) => {
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
  });

  if (isNode()) {
    channel.terminateWorker();
  }

  if (errMsg) {
    throw new Error(errMsg);
  }

  return output;
}
