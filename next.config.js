module.exports = {
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
};
