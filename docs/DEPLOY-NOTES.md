# Deployment Notes

## Vercel Configuration

This project intentionally does **not** use a project-level `vercel.json` or `now.json` configuration file.

Instead, we rely on **per-function runtime configuration** set directly in each API handler file:

```javascript
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // handler logic
}
```

### Why?

- **Avoids conflicts** with legacy Vercel builders (e.g., `now-php@1.0.0`, `@now/node@`)
- **Explicit per-function control** - each API route can specify its own runtime
- **Simpler configuration** - no need for project-level `functions` mapping
- **ESM-first** - all handlers use ES modules with `export default`

### Current Runtime

All API functions in `api/**/*.js` are configured to use:
- **Runtime**: `nodejs`
- **Module System**: ESM (`"type": "module"` in `package.json`)
- **Node Version**: `20.x` (specified in `package.json` engines)

### Adding New API Routes

When adding new API handlers:

1. Create the file in `api/` directory
2. Include the runtime config:
   ```javascript
   export const config = { runtime: 'nodejs' };
   ```
3. Export default handler function
4. Use ESM imports (no `require()` or `module.exports`)

Vercel will automatically detect and deploy the function based on the file path and per-function config.
