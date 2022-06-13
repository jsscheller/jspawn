import { toWorker, ToWorker, Message, MessageType } from "./workerChannel";
import { isNode } from "./utils";

declare type Options = {
  env?: { [k: string]: string };
};

declare type Output = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function run(
  wasmBinary: string,
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
    wasmBinary,
    args,
    env: opts.env || {},
  });
  let output = {
    stdout: "",
    stderr: "",
    exitCode: -1,
  };
  const decoder = new TextDecoder();
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
    }
  });

  if (isNode()) {
    channel.terminateWorker();
  }

  return output;
}
