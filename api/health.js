import { stat } from 'node:fs/promises';
import path from 'node:path';

export const config = { runtime: 'nodejs' };

async function resolveCalibration() {
  const publicPath = path.join(
    process.cwd(),
    'public',
    'data',
    'calibration_v1.json'
  );
  const dataPath = path.join(process.cwd(), 'data', 'calibration_v1.json');

  try {
    const stats = await stat(publicPath);
    if (stats.isFile()) {
      return { servedFrom: 'public', size: stats.size };
    }
  } catch {
    // ignore
  }

  try {
    const stats = await stat(dataPath);
    if (stats.isFile()) {
      return { servedFrom: 'data', size: stats.size };
    }
  } catch {
    // ignore
  }

  return { servedFrom: 'none', size: null };
}

export default async function handler(_req, res) {
  const persistenceEnabled =
    String(process.env.FINISHLINE_PERSISTENCE_ENABLED || '').toLowerCase() ===
    'true';
  const hasRedis =
    Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
    Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

  const calibration = await resolveCalibration();

  res.status(200).json({
    ok: true,
    ts: Date.now(),
    node: process.version,
    persistence: {
      enabled: persistenceEnabled,
      hasRedis,
    },
    calibration,
  });
}
