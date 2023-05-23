import { VirtualEnv } from "/base/dist/esm/jspawn.mjs";

describe("node fs tests", function () {
  let venv;

  before(async function () {
    venv = await VirtualEnv.instantiate();
  });

  after(async function () {
    venv.terminate();
  });

  it("mkdir/readdir", async function () {
    await venv.fs.mkdir("foo");
    const empty = await venv.fs.readdir("foo");
    expect(empty.length).to.equal(0);

    await venv.fs.mkdir("foo/bar");
    const one = await venv.fs.readdir("foo");
    expect(one.length).to.equal(1);

    await venv.fs.rmdir("foo", { recursive: true });

    let err;
    try {
      await venv.fs.readdir("foo");
    } catch (_) {
      err = true;
    }
    expect(err).to.equal(true);
  });
});
