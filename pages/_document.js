import { Html, Head, Main, NextScript } from "next/document";
import crypto from 'node:crypto';

export default function Document() {
  // Compute token version (safe to expose, not the raw token)
  const familyToken = process.env.FAMILY_UNLOCK_TOKEN || null;
  let tokenVersion = null;
  if (familyToken) {
    tokenVersion = crypto.createHash('sha256').update(familyToken).digest('hex').slice(0, 12);
  }
  const familyUnlockDays = parseInt(process.env.FAMILY_UNLOCK_DAYS || '365', 10);
  
  return (
    <Html>
      <Head>
        {/* Inject token version (NOT raw token) before any other scripts */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ = ${JSON.stringify(tokenVersion)};
window.__FL_FAMILY_UNLOCK_DAYS__ = ${familyUnlockDays};`,
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
