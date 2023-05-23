# jspawn

A subprocess API for WebAssembly programs.

- Supports WASI and Emscripten binaries
- Works in the browser and Node.js
- Async interface (programs run in worker threads)

Compiling and interfacing with WebAssembly programs can be hard. `jspawn` provides a unified interface and a collection of pre-built binaries.

**WARNING:** expect breaking/backwards-incompatible changes for MINOR versions before `v1.0.0`.

```sh
npm install --save @jspawn/jspawn
```

## Examples

### Node

**index.mjs**

```javascript
// Or `const { VirtualEnv } = require("@jspawn/jspawn");`
import { VirtualEnv } from "@jspawn/jspawn";

const venv = await VirtualEnv.instantiate();

// WASM/binary resolution happens automatically in node when the first argument isn't a path -
// more specifically, it doesn't contain a path-separator and doesn't end with `.wasm`.
const output = await venv.run(
  // Assumes `@jspawn/imagemagick-wasm` is installed.
  // `npm install --save @jspawn/imagemagick-wasm`
  "magick",
  // Create a blank PNG.
  ["-size", "100x100", "xc:blue", "blank.png"]
);
console.log(output); // { exitCode: 0, stdout: "", stderr: "" }
```

Run with:

```sh
# Depending on your version of node, you may not need the experimental flags.
node --experimental-wasm-bigint --experimental-wasi-unstable-preview1 index.mjs
```

### Browser

```javascript
import { VirtualEnv } from "https://unpkg.com/@jspawn/jspawn/esm/jspawn.mjs";

const venv = await VirtualEnv.instantiate();

const output = await venv.run(
  // Full path to a WASM file - no automatic resolution in the browser.
  "https://unpkg.com/@jspawn/imagemagick-wasm/magick.wasm",
  // Create a blank PNG.
  ["-size", "100x100", "xc:blue", "blank.png"]
);

console.log(output); // { exitCode: 0, stdout: "", stderr: "" }

// The file system lives in memory for browser environments.
// Access it using the `fs` module.
const png = await venv.fs.readFileToBlob("blank.png");

// Now, do what you will with the `Blob`.
// Maybe display it.
const img = document.createElement("img");
img.src = URL.createObjectURL(png);
document.body.append(img);
```

