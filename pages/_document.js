import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html>
      <Head></Head>
      <body>
        <Main />
        <NextScript />
        <script defer src="/js/verify-injector.js"></script>
        <script defer src="/js/verify-tab.js"></script>
      </body>
    </Html>
  );
}

