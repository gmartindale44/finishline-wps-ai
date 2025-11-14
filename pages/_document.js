import Document, { Html, Head, Main, NextScript } from "next/document";
import Script from "next/script";

export default class MyDocument extends Document {
  render() {
    return (
      <Html>
        <Head />
        <body>
          <Main />
          <NextScript />
          <Script
            id="fl-verify-loader-backstop"
            src="/js/verify-loader.js?v=v2025-11-13-datefix-final2"
            strategy="afterInteractive"
          />
        </body>
      </Html>
    );
  }
}
