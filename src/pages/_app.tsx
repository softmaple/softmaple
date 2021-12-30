import { globalStyles } from "@/styles";

export default function App({ Component, pageProps }) {
  return (
    <>
      {globalStyles}
      <Component {...pageProps} />
    </>
  );
}
