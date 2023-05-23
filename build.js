const child_process = require("child_process");
const util = require("util");
const execFile = util.promisify(child_process.execFile);
const os = require("os");
const fs = require("fs/promises");
const path = require("path");
const esbuild = require("esbuild");

const distDir = path.join(__dirname, "dist");

async function main() {
  try {
    await fs.rm(distDir, { recursive: true });
  } catch (_) {}
  await fs.mkdir(distDir, { recursive: true });

  await genTypes();
  await compileFS();
  await bundle();

  // wasm gets inlined
  await fs.rm(path.join(distDir, "fs.wasm"));
}

async function genTypes() {
  const typesDir = path.join(distDir, "types");

  await new Promise((resolve, reject) => {
    const tsc = path.join(__dirname, "node_modules/typescript/bin/tsc");
    child_process
      .spawn(tsc, ["--emitDeclarationOnly", "--outDir", typesDir], {
        stdio: ["pipe", process.stdout, process.stderr],
      })
      .on("close", (code) => {
        code ? reject(code) : resolve();
      });
  });
}

async function compileFS() {
  const env = { RUSTFLAGS: releaseRustFlags(), ...process.env };
  await execFile("cargo", ["build", "--release"], {
    env,
    cwd: path.join(__dirname, "fs"),
  });

  const wasmPath = "fs/target/wasm32-unknown-unknown/release/fs.wasm";
  await optimizeWasm(wasmPath);

  await fs.rename(wasmPath, path.join(distDir, "fs.wasm"));
}

function releaseRustFlags() {
  const baseDir = path.join(__dirname, "fs");
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
  // wasm-opt version 108 (version_108-53-g0b66981d0)
  await execFile("wasm-opt", ["-Oz", "-o", optPath, wasmPath]);
  await fs.rename(optPath, wasmPath);
}

async function bundle() {
  const { outputFiles } = await esbuild.build({
    entryPoints: ["src/workerThread.ts"],
    bundle: true,
    write: false,
    format: "iife",
    loader: {
      ".wasm": "empty",
    },
    plugins: [workerPlugin()],
  });
  const workerJS = outputFiles[0].contents;

  await fs.writeFile(path.join(distDir, "worker.js"), workerJS);

  for (const format of ["esm", "cjs", "iife"]) {
    await bundleFormat(format, workerJS);
  }
}

async function bundleFormat(format, workerJS) {
  await esbuild.build({
    entryPoints: ["src/jspawn.ts"],
    outdir: path.join(path.basename(distDir), format),
    bundle: true,
    write: true,
    format: format,
    globalName: format === "iife" ? "jspawn" : undefined,
    loader: {
      ".wasm": "binary",
    },
    plugins: [workerPlugin(workerJS)],
  });

  if (format === "esm") {
    await fs.cp(
      path.join(distDir, "esm/jspawn.js"),
      path.join(distDir, "esm/jspawn.mjs")
    );
  }
}

const workerPlugin = (workerJS) => {
  return {
    name: "worker",
    setup(build) {
      build.onResolve({ filter: /^worker:/ }, (args) => {
        return {
          path: args.path.split(":").pop(),
          namespace: "worker",
        };
      });

      build.onLoad({ filter: /.*/, namespace: "worker" }, async (args) => {
        if (workerJS) {
          return {
            loader: "text",
            contents: workerJS,
          };
        } else {
          return {
            loader: "js",
            contents: 'export default "";',
          };
        }
      });
    },
  };
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
