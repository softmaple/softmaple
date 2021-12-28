const withTM = require("next-transpile-modules")([
  "@zhyd1997/draftjs-to-latex",
]);

module.exports = withTM({
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/",
        destination: "/editor",
        permanent: true,
      },
    ];
  },
});
