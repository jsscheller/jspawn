const util = require("util");
const execFile = util.promisify(require("child_process").execFile);
const os = require("os");
const fs = require("fs/promises");
const path = require("path");

async function main() {
  await execFile("./node_modules/rollup/dist/bin/rollup", ["-c"]);

  const env = { RUSTFLAGS: releaseRustFlags(), ...process.env };
  await execFile("cargo", ["build", "--release"], {
    env,
    cwd: path.resolve("./fs"),
  });

  const wasmPath = "fs/target/wasm32-unknown-unknown/release/fs.wasm";
  await optimizeWasm(wasmPath);

  await fs.rename(wasmPath, "dist/fs.wasm");
}

function releaseRustFlags() {
  const baseDir = path.resolve("./fs");
  return [
    // Remove system-specific paths.
    // https://github.com/rust-lang/rust/issues/89410
    `--remap-path-prefix=${os.homedir()}=/`,
    `--remap-path-prefix=${baseDir}=/`,
    "-C target-feature=+atomics,+bulk-memory,+mutable-globals",
  ].join(" ");
}

async function optimizeWasm(wasmPath) {
  const optPath = `${wasmPath}.opt`;
  await execFile("wasm-opt", ["-Oz", "-o", optPath, wasmPath]);
  await fs.rename(optPath, wasmPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
