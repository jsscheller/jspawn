import { VirtualEnv } from "/base/dist/esm/jspawn.mjs";

describe("browser ESM tests", function () {
  let venv;

  before(async function () {
    venv = await VirtualEnv.instantiate();
  });

  after(async function () {
    venv.terminate();
  });

  it("works with Emscripten program", async function () {
    const output = await venv.run(
      "/base/node_modules/@jspawn/imagemagick-wasm/magick.wasm",
      ["-size", "100x100", "xc:white", "blank_em.png"]
    );
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFileToBlob("blank_em.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("works with WASI program", async function () {
    const output = await venv.run(
      "/base/node_modules/@jspawn/imagecli-wasm/imagecli.wasm",
      ["-o", "blank_wasi.png", "-p", "new 100 100 (255, 255, 0)"]
    );
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFileToBlob("blank_wasi.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("resolves the correct path to WASM file", async function () {
    venv.setBinarySearchPath(
      "/base/node_modules/@jspawn/imagecli-wasm/imagecli.wasm"
    );
    const output = await venv.run("imagecli", [
      "-o",
      "blank_wasi_resolved.png",
      "-p",
      "new 100 100 (255, 255, 0)",
    ]);
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFileToBlob("blank_wasi_resolved.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("resolves the correct path to WASM file (Emscripten)", async function () {
    venv.setBinarySearchPath(
      "/base/node_modules/@jspawn/imagemagick-wasm/magick.wasm"
    );
    const output = await venv.run("magick", [
      "-size",
      "100x100",
      "xc:white",
      "blank_em_resolved.png",
    ]);
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFileToBlob("blank_em_resolved.png");
    expect(outPNG.size).to.not.equal(0);
  });

  it("works with Emscripten pthreads", async function () {
    await venv.fs.mount("sample.mp4", "/base/tests/assets/sample.mp4");
    const output = await venv.run(
      "/base/node_modules/@jspawn/ffmpeg-wasm/ffmpeg.wasm",
      ["-i", "sample.mp4", "-threads", "1", "out.mp3"]
    );
    expect(output.exitCode).to.equal(0);

    const outMP3 = await venv.fs.readFileToBlob("out.mp3");
    expect(outMP3.size).to.not.equal(0);
  });
});
