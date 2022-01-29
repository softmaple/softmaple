module.exports = {
  "**/*.ts?(x)": (filenames) =>
    filenames.map((file) => `prettier --write '${file}'`),
};
