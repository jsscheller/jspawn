import { subprocess, fs } from "/base/dist/esm/jspawn.mjs";

describe("browser ESM tests", function () {
  it("works with Emscripten program", async function () {
    const output = await subprocess.run(
      "/base/node_modules/@jspawn/imagemagick-wasm/magick.wasm",
      ["-size", "100x100", "xc:white", "blank_em.png"]
    );
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await fs.readFileToBlob("blank_em.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("works with WASI program", async function () {
    const output = await subprocess.run(
      "/base/node_modules/@jspawn/imagecli-wasm/imagecli.wasm",
      ["-o", "blank_wasi.png", "-p", "new 100 100 (255, 255, 0)"]
    );
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await fs.readFileToBlob("blank_wasi.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("resolves the correct path to WASM file", async function () {
    subprocess.setBinarySearchPath("/base/node_modules/@jspawn/imagecli-wasm/imagecli.wasm");
    const output = await subprocess.run("imagecli", [
      "-o",
      "blank_wasi_resolved.png",
      "-p",
      "new 100 100 (255, 255, 0)",
    ]);
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await fs.readFileToBlob("blank_wasi_resolved.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("resolves the correct path to WASM file (Emscripten)", async function () {
    subprocess.setBinarySearchPath("/base/node_modules/@jspawn/imagemagick-wasm/magick.wasm");
    const output = await subprocess.run("magick", [
      "-size",
      "100x100",
      "xc:white",
      "blank_em_resolved.png",
    ]);
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await fs.readFileToBlob("blank_em_resolved.png");
    expect(outPNG.size).to.not.equal(0);
  });
});
