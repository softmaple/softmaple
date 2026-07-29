module.exports = {
  "**/*.{js,jsx,ts,tsx}":
    "biome format --config-path=biome.json --write --no-errors-on-unmatched",
};
