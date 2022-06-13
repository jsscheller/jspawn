import { terminateToWorker } from "./workerChannel";
import "./worker";

export * as fs from "./fs";
export * as subprocess from "./subprocess";

export function terminateWorker() {
  terminateToWorker();
}
