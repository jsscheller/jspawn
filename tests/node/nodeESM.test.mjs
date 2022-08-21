import * as jspawn from "../../dist/esm/jspawn.mjs";
import * as jspawnMin from "../../dist/esm/jspawn.min.mjs";
import { expect } from "chai";

describe("node ESM tests", function () {
  for (const jspawn_ of [jspawn, jspawnMin]) {
    const suffix = jspawn_ === jspawnMin ? " (min)" : "";
    const { chdir, fs, subprocess } = jspawn_;
    it(`works with Emscripten program${suffix}`, async function () {
      const output = await subprocess.run(
        "node_modules/@jspawn/imagemagick-wasm/magick.wasm",
        ["-size", "100x100", "xc:white", "blank_em.png"]
      );
      expect(output.exitCode).to.equal(0);
      expect(output.stdout).to.equal("");
      expect(output.stderr).to.equal("");

      const outPNG = await fs.readFile("blank_em.png");
      expect(outPNG.length).to.not.equal(0);
    });

    it(`works with WASI program${suffix}`, async function () {
      const output = await subprocess.run(
        "node_modules/@jspawn/imagecli-wasm/imagecli.wasm",
        ["-o", "blank_wasi.png", "-p", "new 100 100 (255, 255, 0)"]
      );
      expect(output.exitCode).to.equal(0);
      expect(output.stdout).to.equal("");
      expect(output.stderr).to.equal("");

      const outPNG = await fs.readFile("blank_wasi.png");
      expect(outPNG.length).to.not.equal(0);
    });

    it(`resolves the correct path to WASM file${suffix}`, async function () {
      const output = await subprocess.run("imagecli", [
        "-o",
        "blank_wasi_resolved.png",
        "-p",
        "new 100 100 (255, 255, 0)",
      ]);
      expect(output.exitCode).to.equal(0);
      expect(output.stdout).to.equal("");
      expect(output.stderr).to.equal("");

      const outPNG = await fs.readFile("blank_wasi_resolved.png");
      expect(outPNG.length).to.not.equal(0);
    });

    it(`resolves the correct path to WASM file (Emscripten)${suffix}`, async function () {
      const output = await subprocess.run("magick", [
        "-size",
        "100x100",
        "xc:white",
        "blank_em_resolved.png",
      ]);
      expect(output.exitCode).to.equal(0);
      expect(output.stdout).to.equal("");
      expect(output.stderr).to.equal("");

      const outPNG = await fs.readFile("blank_em_resolved.png");
      expect(outPNG.length).to.not.equal(0);
    });

    it(`works with Emscripten pthreads${suffix}`, async function () {
      await fs.mount("./tests/assets/sample.mp4", "sample.mp4");
      const output = await subprocess.run("ffmpeg", [
        "-i",
        "sample.mp4",
        "-threads",
        "1",
        "out.mp3",
      ]);
      expect(output.exitCode).to.equal(0);

      const outMP3 = await fs.readFile("out.mp3");
      expect(outMP3.length).to.not.equal(0);
    });

    it(`chdir works with Emscripten${suffix}`, async function () {
      await fs.mount(
        {
          "sample.mp4": "./tests/assets/sample.mp4",
        },
        "foo"
      );
      await chdir("foo");
      const output = await subprocess.run("ffmpeg", [
        "-i",
        "sample.mp4",
        "-threads",
        "1",
        "out.mp3",
      ]);
      expect(output.exitCode).to.equal(0);

      const outMP3 = await fs.readFile("~/foo/out.mp3");
      expect(outMP3.length).to.not.equal(0);
    });
  }
});
