// pages/api/calibration_status.js - Read-only calibration status endpoint

import { keys as redisKeys, hgetall as redisHGetAll } from '../../../lib/redis.js';
import fs from 'fs';
import path from 'path';

export const config = { runtime: 'nodejs' };

/**
 * Count CSV rows (excluding header)
 */
function countCsvRows(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return 0;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    // Exclude header line
    return Math.max(0, lines.length - 1);
  } catch (err) {
    console.warn('[calibration_status] CSV count error:', err?.message || err);
    return 0;
  }
}

/**
 * Read model_params.json and extract tau, bands, mtime
 */
function readModelParams(filePath) {
  const result = {
    exists: false,
    mtime: null,
    tau: null,
    bands: null,
  };

  try {
    if (!fs.existsSync(filePath)) {
      return result;
    }

    const stats = fs.statSync(filePath);
    result.exists = true;
    result.mtime = stats.mtime.toISOString();

    const content = fs.readFileSync(filePath, 'utf-8');
    const params = JSON.parse(content);

    // Extract tau - check nested structure first, then fallback
    if (params.temperature?.tau != null) {
      result.tau = Number(params.temperature.tau);
    } else if (params.temp_tau != null) {
      result.tau = Number(params.temp_tau);
    }

    // Extract bands - check for array first, then count policy keys
    if (params.policy?.bands && Array.isArray(params.policy.bands)) {
      result.bands = params.policy.bands.length;
    } else if (params.policy && typeof params.policy === 'object') {
      // Count policy keys (e.g., "60-64", "65-69", etc.)
      const policyKeys = Object.keys(params.policy).filter(k => k !== 'bands');
      result.bands = policyKeys.length > 0 ? policyKeys.length : null;
    }
  } catch (err) {
    console.warn('[calibration_status] Params read error:', err?.message || err);
    // Keep defaults (exists=true if file was found, but parsing failed)
  }

  return result;
}

/**
 * Count Redis keys by status
 */
async function countRedisStatus() {
  let pending = 0;
  let resolved = 0;

  try {
    const redisEnv = {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    };

    if (!redisEnv.url || !redisEnv.token) {
      return { pending: 0, resolved: 0 };
    }

    // Get all keys matching pattern
    const keyPattern = 'fl:pred:*';
    const allKeys = await redisKeys(keyPattern);

    // Tally status for each key
    for (const key of allKeys) {
      try {
        const hash = await redisHGetAll(key);
        const status = hash?.status || '';
        if (status === 'pending') {
          pending++;
        } else if (status === 'resolved') {
          resolved++;
        }
      } catch (err) {
        // Skip individual key errors
        console.debug('[calibration_status] Key read skip:', err?.message || err);
      }
    }
  } catch (err) {
    console.warn('[calibration_status] Redis count error:', err?.message || err);
    // Return zeros on error
  }

  return { pending, resolved };
}

/**
 * Main handler
 */
export default async function handler(_req, res) {
  try {
    // File paths (relative to project root)
    const csvPath = path.join(process.cwd(), 'data', 'finishline_tests_v1.csv');
    const paramsPath = path.join(process.cwd(), 'data', 'model_params.json');

    // Count CSV rows
    const csvRows = countCsvRows(csvPath);

    // Read model params
    const params = readModelParams(paramsPath);

    // Count Redis status
    const redis = await countRedisStatus();

    // Build response
    const response = {
      ok: true,
      csv_rows: csvRows,
      params_exists: params.exists,
      params_mtime: params.mtime,
      tau: params.tau,
      bands: params.bands,
      redis_pending: redis.pending,
      redis_resolved: redis.resolved,
    };

    res.status(200).json(response);
  } catch (err) {
    // Always return ok:true with best-effort fields
    console.error('[calibration_status] Handler error:', err?.message || err);
    res.status(200).json({
      ok: true,
      csv_rows: 0,
      params_exists: false,
      params_mtime: null,
      tau: null,
      bands: null,
      redis_pending: 0,
      redis_resolved: 0,
    });
  }
}

