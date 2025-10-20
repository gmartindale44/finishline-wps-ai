"""
Custom Research Provider
Integrates with user-owned research API for horse racing data enrichment
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional, Tuple
import os, time, math
import httpx

_DEF_TIMEOUT_MS = int(os.getenv("FINISHLINE_PROVIDER_TIMEOUT_MS", "4000"))
_TTL_SECONDS = int(os.getenv("FINISHLINE_PROVIDER_CACHE_SECONDS", "900"))
_BASE = os.getenv("FINISHLINE_RESEARCH_API_URL", "").rstrip("/")
_KEY  = os.getenv("FINISHLINE_RESEARCH_API_KEY", "")
_DBG  = (os.getenv("FINISHLINE_PROVIDER_DEBUG","false").lower() == "true")

_cache: Dict[Tuple[str,str], Tuple[float, Any]] = {}

def _log(*args):
    if _DBG: print("[CustomProvider]", *args)

def _get_cached(key: Tuple[str,str]):
    now = time.time()
    hit = _cache.get(key)
    if not hit: return None
    ts, data = hit
    if now - ts > _TTL_SECONDS: 
        _cache.pop(key, None)
        return None
    return data

def _set_cached(key: Tuple[str,str], data: Any):
    _cache[key] = (time.time(), data)

def _auth_headers() -> Dict[str,str]:
    hdr = {"Accept": "application/json"}
    if _KEY:
        hdr["Authorization"] = f"Bearer {_KEY}"
    return hdr

async def _get_json(client: httpx.AsyncClient, path: str, params: Dict[str,str]) -> Any:
    if not _BASE:
        return None
    url = f"{_BASE}{path}"
    key = (url, str(sorted(params.items())))
    cached = _get_cached(key)
    if cached is not None:
        return cached
    try:
        r = await client.get(url, params=params, headers=_auth_headers(), timeout=_DEF_TIMEOUT_MS/1000)
        if r.status_code == 200:
            data = r.json()
            _set_cached(key, data)
            return data
        _log("HTTP", r.status_code, url, params)
        return None
    except Exception as e:
        _log("ERR", url, e)
        return None

# ---- Mapping helpers: adjust here to match your API schema ----
def _as_float(x, default=0.0):
    try:
        if x is None: return default
        if isinstance(x, (int,float)): return float(x)
        s = str(x).strip().replace("%","")
        return float(s)/100.0 if "%" in str(x) else float(s)
    except:
        return default

def _pick(d: Dict[str,Any], *keys, default=None):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return default

def _map_horse_features(h: Dict[str,Any], hjson: Dict[str,Any]) -> Dict[str,Any]:
    # Expected candidates; tweak to your API
    last_fig   = _as_float(_pick(hjson, "last_speed_fig","last_speed","speedfig","brz","tfus", default=80), 80)
    pace_style = _pick(hjson, "pace_style","running_style","pace","rs", default="P")
    form_delta = _as_float(_pick(hjson, "form_delta","formChange","form", default=0), 0)
    days_off   = int(_pick(hjson, "days_since","days_off","daysSince", default=21) or 21)
    return {
        **h,
        "last_speed_fig": last_fig,
        "early_pace": str(pace_style).upper()[:2] if pace_style else "P",
        "form_delta": form_delta,
        "days_since_race": days_off,
    }

def _map_person_features(h: Dict[str,Any], trainer_json: Optional[Dict[str,Any]], jockey_json: Optional[Dict[str,Any]]) -> Dict[str,Any]:
    tw = _as_float(_pick(trainer_json or {}, "win_pct","trainer_win_pct","t_win","tWinRate", default=0.12), 0.12)
    jw = _as_float(_pick(jockey_json  or {}, "win_pct","jockey_win_pct","j_win","jWinRate", default=0.12), 0.12)
    return { **h, "trainer_win_pct": tw, "jockey_win_pct": jw }

class CustomProvider:
    async def fetch_race_context(self, *, date: str, track: str, distance: str, surface: str) -> Dict[str,Any]:
        # Optional: /track endpoint
        if not _BASE: 
            return {}
        async with httpx.AsyncClient() as client:
            tj = await _get_json(client, "/track", {"name": track, "date": date, "surface": surface, "distance": distance})
        bias = {}
        if tj and isinstance(tj, dict):
            # Try some common fields; tweak as needed
            bias = _pick(tj, "bias", default={}) or {}
        return {"bias": bias, "source":"custom"}

    async def enrich_one(self, client: httpx.AsyncClient, h: Dict[str,Any], *, date: str, track: str) -> Dict[str,Any]:
        name    = (h.get("name") or "").strip()
        trainer = (h.get("trainer") or "").strip()
        jockey  = (h.get("jockey") or "").strip()

        hj = await _get_json(client, "/horse",   {"name": name, "track": track, "date": date}) if name else None
        tj = await _get_json(client, "/trainer", {"name": trainer}) if trainer else None
        jj = await _get_json(client, "/jockey",  {"name": jockey})  if jockey else None

        h2 = _map_horse_features(h, hj or {})
        h3 = _map_person_features(h2, tj, jj)
        return h3

    async def enrich_horses_async(self, horses: List[Dict[str,Any]], *, date: str, track: str) -> List[Dict[str,Any]]:
        if not _BASE:
            # No API configured → pass-through
            return horses
        async with httpx.AsyncClient() as client:
            out = []
            for h in horses:
                out.append(await self.enrich_one(client, h, date=date, track=track))
        return out

    async def enrich_horses(self, horses: List[Dict[str,Any]], *, date: str, track: str) -> List[Dict[str,Any]]:
        # Async method - called directly from FastAPI endpoint (no asyncio.run needed)
        return await self.enrich_horses_async(horses, date=date, track=track)

