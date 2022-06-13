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
        pattern: "dist/iife/jspawn.js",
        watched: false,
      },
      {
        pattern: "dist/**/*.@(mjs|js)",
        included: false,
      },
      {
        pattern: "tests/browser/*.test.js",
        type: "module",
      },
    ],
    browsers: ["Chrome"],
    reporters: ["progress"],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: true,
    singleRun: true,
    concurrency: Infinity,
  };

  config.set(configuration);
};
