module.exports = {
  "**/*.ts?(x)": (filenames) =>
    filenames.map((file) => `prettier --write '${file}'`),
  "**/*.ts?(x)": (filenames) =>
    `next lint --fix --file ${filenames
      .map((file) => file.split(process.cwd())[1])
      .join(" --file ")}`,
};
