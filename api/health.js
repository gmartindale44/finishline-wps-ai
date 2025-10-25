export const config = { runtime: "nodejs" };
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    runtime: "node",
    keyLoaded: !!(process.env.FINISHLINE_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
    model: process.env.FINISHLINE_OPENAI_MODEL || process.env.FINISHLINE_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
  });
}
