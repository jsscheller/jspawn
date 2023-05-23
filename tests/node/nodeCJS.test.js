const { VirtualEnv } = require("../../dist/cjs/jspawn.js");
const { expect } = require("chai");

describe("node CJS tests", function () {
  let venv;

  before(async function () {
    venv = await VirtualEnv.instantiate();
  });

  after(async function () {
    venv.terminate();
  });

  it("works with Emscripten program", async function () {
    const output = await venv.run(
      "node_modules/@jspawn/imagemagick-wasm/magick.wasm",
      ["-size", "100x100", "xc:white", "blank_em.png"]
    );
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFile("blank_em.png");
    expect(outPNG.length).to.not.equal(0);
  });

  it("works with WASI program", async function () {
    const output = await venv.run(
      "node_modules/@jspawn/imagecli-wasm/imagecli.wasm",
      ["-o", "blank_wasi.png", "-p", "new 100 100 (255, 255, 0)"]
    );
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFile("blank_wasi.png");
    expect(outPNG.length).to.not.equal(0);
  });
});
