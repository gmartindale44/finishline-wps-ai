import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  // bump this when you want to force cache busting
  const VER_TAB_VERSION = "v2025-11-10-1";
  return (
    <Html>
      <Head />
      <body>
        <Main />
        <NextScript />
        <script
          defer
          src={`/js/verify-tab.js?${VER_TAB_VERSION}`}
        ></script>
      </body>
    </Html>
  );
}
