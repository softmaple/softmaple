module.exports = {
  "**/*.ts?(x)": (filenames) =>
    filenames.map((file) => `prettier --write '${file}'`),
  "**/*.ts?(x)": [
    "eslint --fix",
    "tsc --noEmit --incremental false",
  ],
};
