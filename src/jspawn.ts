import "./workerThread";
import { request, MessageType, FSRequestType, FSResponse } from "./worker";

export * as fs from "./fs";
export * as subprocess from "./subprocess";

export async function chdir(dir: string) {
  const { err } = await request<FSResponse>({
    type: MessageType.FSRequest,
    fsType: FSRequestType.Chdir,
    args: [dir],
  });
  if (err) {
    throw new Error(err);
  }
}
