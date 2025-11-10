export async function cseResolve(query) {
  const res = await fetch(
    `/api/cse_resolver?q=${encodeURIComponent(query)}`,
    {
      headers: { Accept: "application/json" },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `CSE resolver failed: ${res.status} ${text.slice(0, 200)}`
    );
  }
  return res.json();
}


