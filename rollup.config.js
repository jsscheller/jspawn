import typescript from "rollup-plugin-typescript2";
import { terser } from "rollup-plugin-terser";

function config({ format, minify, input, ext = "js" }) {
  const dir = `dist/${format}/`;
  const minifierSuffix = minify ? ".min" : "";
  return {
    input: `./src/${input}.ts`,
    output: {
      name: "jspawn",
      file: `${dir}/${input}${minifierSuffix}.${ext}`,
      format,
      sourcemap: true,
    },
    plugins: [
      typescript({
        clean: true,
        typescript: require("typescript"),
      }),
      minify
        ? terser({
            compress: true,
            mangle: true,
          })
        : undefined,
    ].filter(Boolean),
  };
}

require("rimraf").sync("dist");

export default [
  { input: "jspawn", format: "esm", minify: false },
  { input: "jspawn", format: "esm", minify: false, ext: "mjs" },
  { input: "jspawn", format: "umd", minify: false },
  { input: "jspawn", format: "iife", minify: false },
  { input: "worker", format: "umd", minify: false, ext: "cjs" },
].map(config);
