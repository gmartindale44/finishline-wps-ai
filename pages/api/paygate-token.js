// pages/api/paygate-token.js
// Returns a JavaScript file that sets the family unlock token from env var
// This works for static HTML files that can't use Next.js _document.js

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  // Set content type to JavaScript
  res.setHeader('Content-Type', 'application/javascript');
  
  // Get token from environment variable
  const token = process.env.FAMILY_UNLOCK_TOKEN || null;
  
  // Return JavaScript that sets window variable and logs confirmation
  // Use JSON.stringify to safely escape the token value
  const js = `window.__FL_FAMILY_UNLOCK_TOKEN__ = ${JSON.stringify(token)};
console.log('[PayGate] Token script loaded:', { hasToken: ${token !== null} });`;
  
  // Cache for 5 minutes (token changes require redeploy anyway)
  res.setHeader('Cache-Control', 'public, max-age=300');
  
  res.status(200).send(js);
}

