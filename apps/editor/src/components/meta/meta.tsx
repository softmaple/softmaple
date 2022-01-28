import Head from "next/head";

export const Meta = () => {
  return (
    <Head>
      <link
        rel="apple-touch-icon"
        sizes="180x180"
        href="/favicons/apple-touch-icon.png"
      />
      <link
        rel="icon"
        type="image/png"
        sizes="32x32"
        href="/favicons/favicon-32x32.png"
      />
      <link
        rel="icon"
        type="image/png"
        sizes="16x16"
        href="/favicons/favicon-16x16.png"
      />
      <link rel="manifest" href="/favicons/site.webmanifest" />
      <meta name="description" content="A Paper Typesetting Editor." />
      <meta name="viewport" content="width=device-width" />
      <meta charSet="utf-8" />
      <title>SoftMaple</title>
      {/* KaTeX */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/katex@0.15.2/dist/katex.min.css"
        integrity="sha384-MlJdn/WNKDGXveldHDdyRP1R4CTHr3FeuDNfhsLPYrq2t0UBkUdK2jyTnXPEK1NQ"
        crossOrigin="anonymous"
      />
      <script
        defer
        src="https://cdn.jsdelivr.net/npm/katex@0.15.2/dist/katex.min.js"
        integrity="sha384-VQ8d8WVFw0yHhCk5E8I86oOhv48xLpnDZx5T9GogA/Y84DcCKWXDmSDfn13bzFZY"
        crossOrigin="anonymous"
      ></script>
      <script
        defer
        src="https://cdn.jsdelivr.net/npm/webfontloader@1.6.28/webfontloader.js"
        integrity="sha256-4O4pS1SH31ZqrSO2A/2QJTVjTPqVe+jnYgOWUVr7EEc="
        crossOrigin="anonymous"
      ></script>
      {/* Prism.js */}
      <script
        defer
        src="https://cdn.jsdelivr.net/npm/prismjs@1.26.0/components/prism-core.min.js"
      ></script>
      <script
        defer
        src="https://cdn.jsdelivr.net/npm/prismjs@1.26.0/plugins/autoloader/prism-autoloader.min.js"
      ></script>
      {/* Splitbee Web Analytics */}
      <script defer src="https://cdn.splitbee.io/sb.js"></script>
    </Head>
  );
};
