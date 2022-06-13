# jspawn

A subprocess API for WebAssembly programs.

- Supports WASI and Emscripten binaries
- Works in the browser and Node.js
- Async interface (programs run in worker threads)

Compiling and interfacing with WebAssembly programs can be hard. `jspawn` provides a unified interface and a collection of pre-built binaries.

```sh
npm install --save @jspawn/jspawn
```

## Examples

### Node

**index.mjs**

```javascript
// Or `const { subprocess } = require("@jspawn/jspawn");`
import { subprocess } from "@jspawn/jspawn";

const output = await subprocess.run(
  // Can be installed via `npm install --save @jspawn/imagemagick-wasm`
  "node_modules/@jspawn/imagemagick-wasm/magick.wasm",
  // Create a blank PNG.
  ["-size", "100x100", "xc:blue", "blank.png"]
);
console.log(output);
/*
{
  exitCode: 0,
  stdout: "",
  stderr: ""
}
*/
```

Run with:

```sh
# Depending on your version of node, you may not need the experimental flags.
node --experimental-wasm-bigint --experimental-wasi-unstable-preview1 index.mjs
```

### Browser

```javascript
import { subprocess, fs } from "https://unpkg.com/@jspawn/jspawn/esm/jspawn.mjs";

const output = await subprocess.run(
  "https://unpkg.com/@jspawn/imagemagick-wasm/magick.wasm",
  // Create a blank PNG.
  ["-size", "100x100", "xc:blue", "blank.png"]
);

console.log(output);
/*
{
  exitCode: 0,
  stdout: "",
  stderr: ""
}
*/

// The file system lives in memory for browser environments.
// Access it using the `fs` module.
const png = await fs.readFileToBlob("blank.png");

// Now, do what you will with the `Blob`.
// Maybe display it.
const img = document.createElement("img");
img.src = URL.createObjectURL(png);
document.body.append(img);
```

