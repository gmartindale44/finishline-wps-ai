export default async function handler(req, res) {
  try {
    res.status(200).json({ ok: true, queued: 0 });
  } catch (error) {
    res.status(200).json({ ok: true, queued: 0 });
  }
}

