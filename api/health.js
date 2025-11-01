export const config = { runtime: 'nodejs18.x' };

export default async function handler(_req, res) {
  res.status(200).json({ ok:true, ts: Date.now(), node: process.version });
}