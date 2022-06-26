import { fs } from "/base/dist/esm/jspawn.mjs";

describe("node fs tests", function () {
  it("mkdir/readdir", async function () {
    await fs.mkdir("foo");
    const empty = await fs.readdir("foo");
    expect(empty.length).to.equal(0);

    await fs.mkdir("foo/bar");
    const one = await fs.readdir("foo");
    expect(one.length).to.equal(1);

    await fs.rmdir("foo", { recursive: true });

    let err;
    try {
      await fs.readdir("foo");
    } catch (_) {
      err = true;
    }
    expect(err).to.equal(true);
  });
});
