import { fs } from "../../dist/esm/jspawn.mjs";
import { expect } from "chai";
import { dirname } from "path";
import { fileURLToPath } from "url";
import * as path from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("node fs tests", function () {
  it("mounts", async function () {
    await fs.clear();
    {
      await fs.mount(
        {
          foo: {},
          bar: {},
        },
        "."
      );
      const names = await fs.readdir(".");
      expect(names.length).to.equal(2);
    }
    await fs.clear();
    {
      await fs.mount(__dirname, ".");
      const names = await fs.readdir(".");
      expect(names.length > 1).to.be.true;
    }
    await fs.clear();
    {
      await fs.mount(
        {
          foo: __dirname,
        },
        "."
      );
      const names = await fs.readdir("foo");
      expect(names.length > 1).to.be.true;
    }
  });

  it("reads real-file-backed file", async function () {
    await fs.clear();
    await fs.mount(
      {
        foo: fileURLToPath(import.meta.url),
      },
      "."
    );
    const buf = await fs.readFile("foo");
    expect(buf.byteLength > 0).to.be.true;
  });
});
