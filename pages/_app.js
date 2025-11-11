import Script from "next/script";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Script id="fl-verify-loader" src="/js/verify-loader.js?v=v2025-11-11-20" strategy="afterInteractive" />
      <Component {...pageProps} />
    </>
  );
}
