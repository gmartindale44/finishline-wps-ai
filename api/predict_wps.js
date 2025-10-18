export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ detail: 'Method Not Allowed' });
  try {
    const body = req.body || {};
    // TODO: replace with real model
    return res.status(200).json({ ok: true, data: { message: 'predict stub', received: body } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ detail: 'Internal Server Error' });
  }
}
