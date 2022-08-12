import { subscribe, Message, MessageType } from "./worker";

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
  let output = {
    stdout: "",
    stderr: "",
    exitCode: -1,
  };
  const decoder = new TextDecoder();
  let errMsg: string | undefined;

  await subscribe(
    (topic: number) => ({
      type: MessageType.SubprocessRun,
      topic,
      program,
      args,
      env: opts.env || {},
      wasmPath: WASM_PATH,
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
    const err = new Error(`process exited with non-zero exit-code: ${program}`);
    Object.assign(err, output);
    throw err;
  }

  return output;
}
