import { VirtualEnv } from "../../dist/esm/jspawn.mjs";
import { expect } from "chai";
import { dirname } from "path";
import { fileURLToPath } from "url";
import * as path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("node fs tests", function () {
  let venv;

  beforeEach(async function () {
    venv = await VirtualEnv.instantiate();
  });

  afterEach(async function () {
    venv.terminate();
  });

  it("mounts virtual", async function () {
    await venv.fs.mount(".", {
      foo: {},
      bar: {},
    });
    const names = await venv.fs.readdir(".");
    expect(names.length).to.equal(2);
  });

  it("mounts real", async function () {
    await venv.fs.mount(".", __dirname);
    const names = await venv.fs.readdir(".");
    expect(names.length > 1).to.be.true;
  });

  it("mounts virtual/real", async function () {
    await venv.fs.mount(".", {
      foo: __dirname,
    });
    const names = await venv.fs.readdir("foo");
    expect(names.length > 1).to.be.true;
  });

  it("reads real-file-backed file", async function () {
    await venv.fs.mount(".", {
      foo: fileURLToPath(import.meta.url),
    });
    const buf = await venv.fs.readFile("foo");
    expect(buf.byteLength > 0).to.be.true;
  });
});
