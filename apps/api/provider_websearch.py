"""
WebSearch Provider
Uses Tavily web search + OpenAI to extract racing features from public pages
No database required - pure web research with TTL caching
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import os, time, re, json
import httpx
from bs4 import BeautifulSoup

_DBG   = (os.getenv("FINISHLINE_PROVIDER_DEBUG","false").lower()=="true")
_TTL   = int(os.getenv("FINISHLINE_PROVIDER_CACHE_SECONDS","900"))
_TO_S  = float(int(os.getenv("FINISHLINE_PROVIDER_TIMEOUT_MS","7000"))/1000.0)
_TAV   = os.getenv("FINISHLINE_TAVILY_API_KEY","").strip()
_OAI   = os.getenv("FINISHLINE_OPENAI_API_KEY","").strip()
_OAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL","gpt-4o-mini")

_cache: Dict[Tuple[str,str], Tuple[float, Any]] = {}

def _log(*a): 
    if _DBG: print("[websearch]", *a)

def _get_cached(k): 
    hit = _cache.get(k); 
    if not hit: return None
    ts, val = hit
    if time.time()-ts > _TTL: 
        _cache.pop(k, None); 
        return None
    return val

def _set_cached(k, v): 
    _cache[k] = (time.time(), v)

def _simple_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for s in soup(["script","style","noscript"]): s.extract()
    txt = soup.get_text(" ")
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt[:15000]  # cap for token sanity

async def _tavily_search(client: httpx.AsyncClient, q: str) -> List[str]:
    if not _TAV: return []
    url = "https://api.tavily.com/search"
    try:
        r = await client.post(url, json={
            "api_key": _TAV, "query": q, "max_results": 3, "include_raw_content": False
        }, timeout=_TO_S)
        if r.status_code==200:
            data = r.json()
            links = [it.get("url") for it in data.get("results", []) if it.get("url")]
            return links[:3]
        _log("tavily status", r.status_code, r.text[:200])
    except Exception as e:
        _log("tavily error", e)
    return []

async def _fetch_text(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url, timeout=_TO_S)
        if r.status_code==200 and r.text:
            return _simple_text(r.text)
    except Exception as e:
        _log("fetch err", url, e)
    return ""

# --- OpenAI extraction ---
def _openai_extract(blob: str, role: str, name: str) -> Dict[str, Any]:
    # Synchronous OpenAI extract (small prompt). If key missing: return {}
    if not _OAI: return {}
    from openai import OpenAI
    c = OpenAI(api_key=_OAI)
    sys = (
        "You extract racing features from raw web text. "
        "Return a short JSON object with keys:\n"
        "trainer_win_pct (0..1 float, if trainer context), "
        "jockey_win_pct (0..1 float, if jockey context), "
        "last_speed_fig (0..120 int if mentioned), "
        "early_pace (E,EP,P,S if style mentioned), "
        "form_delta (-1/0/1 if trending down/flat/up), "
        "days_since (int if recent layoff mentioned). "
        "If a key not found, omit it. Do NOT add commentary—JSON only."
    )
    usr = f"ROLE={role}\nNAME={name}\nTEXT:\n{blob[:9000]}"
    try:
        resp = c.chat.completions.create(
            model=_OAI_MODEL,
            messages=[{"role":"system","content":sys},{"role":"user","content":usr}],
            temperature=0.1,
            max_tokens=300,
        )
        content = resp.choices[0].message.content.strip()
        # model sometimes wraps in code fences
        m = re.search(r'\{.*\}', content, re.S)
        if m: content = m.group(0)
        data = json.loads(content)
        if isinstance(data, dict): return data
    except Exception as e:
        _log("openai extract err", e)
    return {}

async def _gather_entity(client, query: str, role: str, name: str) -> Dict[str,Any]:
    key = ("ent", f"{role}:{name}")
    hit = _get_cached(key)
    if hit is not None: return hit
    urls = await _tavily_search(client, query)
    texts = []
    for u in urls:
        t = await _fetch_text(client, u)
        if t: texts.append(t)
    blob = "\n\n---\n\n".join(texts)[:12000]
    data = _openai_extract(blob, role, name) if blob else {}
    _set_cached(key, data)
    return data

class WebSearchProvider:
    async def fetch_race_context(self, *, date: str, track: str, distance: str, surface: str) -> Dict[str,Any]:
        # Try to infer track bias if any public article mentions it
        if not (_TAV and _OAI and track):
            return {}
        async with httpx.AsyncClient() as client:
            data = await _gather_entity(client, f"{track} track bias {surface} {distance}", "track", track)
        # Expect maybe {"bias":{"speed":0.05,"closer":0.02}}; if not, empty
        bias = data.get("bias") if isinstance(data, dict) else None
        return {"bias": bias or {}, "source":"websearch"}

    async def enrich_horses(self, horses: List[Dict[str,Any]], *, date: str, track: str) -> List[Dict[str,Any]]:
        # Async method - called directly from FastAPI endpoint (no asyncio.run needed)
        return await self._enrich_async(horses, date=date, track=track)

    async def _enrich_async(self, horses: List[Dict[str,Any]], *, date: str, track: str) -> List[Dict[str,Any]]:
        if not (_TAV and _OAI):
            # No keys → pass-through
            return horses
        out = []
        async with httpx.AsyncClient() as client:
            for h in horses:
                name    = (h.get("name") or "").strip()
                trainer = (h.get("trainer") or "").strip()
                jockey  = (h.get("jockey") or "").strip()

                horse_q   = f'"{name}" racehorse past performances speed figure pace style'
                trainer_q = f'"{trainer}" trainer win percentage stats'
                jockey_q  = f'"{jockey}" jockey win percentage stats'

                h_feats   = await _gather_entity(client, horse_q, "horse", name) if name else {}
                t_feats   = await _gather_entity(client, trainer_q, "trainer", trainer) if trainer else {}
                j_feats   = await _gather_entity(client, jockey_q, "jockey",  jockey)  if jockey else {}

                # Merge—fields may be missing
                merged = {**h, **{
                    "last_speed_fig": h_feats.get("last_speed_fig", h.get("last_speed_fig")),
                    "early_pace":     (h_feats.get("early_pace") or h.get("early_pace") or "P"),
                    "form_delta":     h_feats.get("form_delta", h.get("form_delta")),
                    "days_since_race": h_feats.get("days_since", h.get("days_since_race")),
                    "trainer_win_pct": t_feats.get("trainer_win_pct", h.get("trainer_win_pct")),
                    "jockey_win_pct":  j_feats.get("jockey_win_pct",  h.get("jockey_win_pct")),
                }}
                out.append(merged)
        return out

