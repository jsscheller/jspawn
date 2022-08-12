import { fs, subprocess } from "../../dist/esm/jspawn.mjs";
import { expect } from "chai";
import { dirname } from "path";
import { fileURLToPath } from "url";
import * as path from "path";
import * as nodeFS from "fs/promises";
import * as child_process from "child_process";
import * as buffer from "buffer";

globalThis.Blob = buffer.Blob;

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("node wasi tests", function () {
  it("env", async function () {
    await runTest("env.rs");
  });

  it("fs", async function () {
    await runTest("fs.rs");
    // Blocked by sync http
    // await runTest("fs_blob.rs");
  });
});

async function runTest(name) {
  const outDir = path.join(__dirname, "../out");
  await nodeFS.mkdir(outDir, { recursive: true });
  const testPath = path.join(__dirname, "../wasi", name);
  const outPath = path.join(outDir, name.split(".")[0] + ".wasm");

  const src = (await nodeFS.readFile(testPath)).toString();
  const init = parseInit(src);

  await new Promise((resolve, reject) => {
    const child = child_process.spawn("rustc", [
      testPath,
      "-o",
      outPath,
      "--target",
      "wasm32-wasi",
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(stdout);
        console.error(stderr);
        reject("rustc failed to compile " + name);
      } else {
        resolve();
      }
    });
  });

  await fs.clear();
  if (init.fs) {
    await fs.mount(init.fs, ".");
  }

  const output = await subprocess.run(outPath, init.args || [], {
    env: init.env,
  });
  expect(output.exitCode).to.equal(0);
}

function parseInit(s) {
  let start = s.indexOf("```json");
  if (start > -1) {
    const end = s.indexOf("```", start + 1);
    if (end === -1) throw "invalid markdown";
    const json = s
      .slice(start + 7, end)
      .split("\n")
      .map((s) => s.slice(2))
      .join("");
    return JSON.parse(json);
  } else {
    start = s.indexOf("```javascript");
    if (start > -1) {
      const end = s.indexOf("```", start + 1);
      if (end === -1) throw "invalid markdown";
      const js = s
        .slice(start + 13, end)
        .split("\n")
        .map((s) => s.slice(2))
        .join("\n");
      const init = new Function(js);
      return init();
    } else {
      return {};
    }
  }
}
