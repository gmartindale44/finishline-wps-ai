import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  // Inject family unlock token from env var (available on all pages)
  const familyToken = process.env.FAMILY_UNLOCK_TOKEN || null;
  
  return (
    <Html>
      <Head>
        {/* Inject family unlock token before any other scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__FL_FAMILY_UNLOCK_TOKEN__ = ${JSON.stringify(familyToken)};`,
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
