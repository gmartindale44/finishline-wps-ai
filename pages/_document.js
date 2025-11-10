import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html>
      <Head></Head>
      <body>
        <Main />
        <script defer src="/js/verify-injector.js"></script>
        <NextScript />
      </body>
    </Html>
  );
}

