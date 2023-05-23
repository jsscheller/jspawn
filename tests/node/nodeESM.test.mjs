import { VirtualEnv } from "../../dist/esm/jspawn.mjs";
import { expect } from "chai";

describe("node ESM tests", function () {
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

  it("resolves the correct path to WASM file", async function () {
    const output = await venv.run("imagecli", [
      "-o",
      "blank_wasi_resolved.png",
      "-p",
      "new 100 100 (255, 255, 0)",
    ]);
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFile("blank_wasi_resolved.png");
    expect(outPNG.length).to.not.equal(0);
  });

  it("resolves the correct path to WASM file (Emscripten)", async function () {
    const output = await venv.run("magick", [
      "-size",
      "100x100",
      "xc:white",
      "blank_em_resolved.png",
    ]);
    expect(output.exitCode).to.equal(0);
    expect(output.stdout).to.equal("");
    expect(output.stderr).to.equal("");

    const outPNG = await venv.fs.readFile("blank_em_resolved.png");
    expect(outPNG.length).to.not.equal(0);
  });

  it("works with Emscripten pthreads", async function () {
    await venv.fs.mount("sample.mp4", "./tests/assets/sample.mp4");
    const output = await venv.run("ffmpeg", [
      "-i",
      "sample.mp4",
      "-threads",
      "1",
      "out.mp3",
    ]);
    expect(output.exitCode).to.equal(0);

    const outMP3 = await venv.fs.readFile("out.mp3");
    expect(outMP3.length).to.not.equal(0);
  });

  it("chdir works with Emscripten", async function () {
    await venv.fs.mount("foo", {
      "sample.mp4": "./tests/assets/sample.mp4",
    });
    await venv.chdir("foo");
    {
      const output = await venv.run("ffmpeg", [
        "-i",
        "~/foo/sample.mp4",
        "-threads",
        "1",
        "../foo/out0.mp3",
      ]);
      expect(output.exitCode).to.equal(0);
    }
    {
      const output = await venv.run("ffmpeg", [
        "-i",
        "~/foo/sample.mp4",
        "-threads",
        "1",
        "out1.mp3",
      ]);
      expect(output.exitCode).to.equal(0);
    }
  });
});
