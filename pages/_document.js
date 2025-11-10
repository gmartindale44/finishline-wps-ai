import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
        {/* Verify Tab assets (no legacy injector) */}
        <script defer src="/js/verify-tab.js"></script>
      </body>
    </Html>
  );
}
