/**
 * why use this plugin?
 * @see https://github.com/hustcc/echarts-for-react/issues/425#issuecomment-900200464
 */
const withTM = require("next-transpile-modules")(["ui", "echarts", "zrender"]);

module.exports = withTM({
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard",
        permanent: true,
      },
    ];
  },
});
