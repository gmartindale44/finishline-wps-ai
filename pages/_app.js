import Script from "next/script";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Script
        id="fl-env-token"
        dangerouslySetInnerHTML={{
          __html: `window.__FL_FAMILY_UNLOCK_TOKEN__ = ${JSON.stringify(process.env.FAMILY_UNLOCK_TOKEN || null)};`,
        }}
        strategy="beforeInteractive"
      />
      <Script id="fl-verify-loader" src="/js/verify-loader.js?v=v2025-11-15-verify-final" strategy="afterInteractive" />
      <Component {...pageProps} />
    </>
  );
}
