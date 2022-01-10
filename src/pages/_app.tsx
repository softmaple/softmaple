import { Meta } from "@/components/meta";
import { globalStyles } from "@/styles";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Meta />
      {globalStyles}
      <Component {...pageProps} />
    </>
  );
}
