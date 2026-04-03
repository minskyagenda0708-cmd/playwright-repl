// Extension test entry point that keeps the extension host alive.
// Used with --extensionTestsPath to prevent VS Code from exiting
// after the extension activates.
module.exports = function run() {
  return new Promise(() => {});
};
