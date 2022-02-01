module.exports = {
  "**/*.ts?(x)": (filenames) =>
    filenames.map((file) => `prettier --write '${file}'`),
  "**/*.ts?(x)": ["typecheck", "eslint --fix"],
};
