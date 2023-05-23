export { VirtualEnv } from "./virtualEnv";

export function setWorkerURL(url: string) {
  // @ts-ignore
  globalThis["WORKER_URL"] = url;
}
