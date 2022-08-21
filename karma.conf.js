module.exports = function (config) {
  const configuration = {
    basePath: "",
    frameworks: ["mocha", "chai"],
    files: [
      {
        pattern: "node_modules/**/*",
        included: false,
      },
      {
        pattern: "tests/assets/*",
        included: false,
      },
      {
        pattern: "dist/iife/jspawn.js",
        watched: false,
      },
      {
        pattern: "dist/**/*.@(mjs|js|wasm)",
        included: false,
      },
      {
        pattern: "tests/browser/*.test.js",
        type: "module",
      },
    ],
    plugins: [
      // Load default karma plugins
      "karma-*",
      {
        "middleware:cross-origin-isolation": [
          "factory",
          CrossOriginIsolationMiddlewareFactory,
        ],
      },
    ],
    beforeMiddleware: ["cross-origin-isolation"],
    browsers: ["Chrome"],
    reporters: ["progress"],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    // Set to false to keep browser open.
    singleRun: true,
    concurrency: Infinity,
  };

  config.set(configuration);
};

function CrossOriginIsolationMiddlewareFactory(config) {
  return function crossOriginIsolation(req, res, next) {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
  };
}
