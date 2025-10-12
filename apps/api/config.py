"""
Configuration and constants for FinishLine WPS AI
Production-safe defaults with environment variable overrides
"""
import os


def get_int_env(name: str, default: int) -> int:
    """Safely get integer from environment variable."""
    try:
        return int(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        return default


def get_bool_env(name: str, default: bool) -> bool:
    """Safely get boolean from environment variable."""
    val = os.getenv(name, str(default)).strip().lower()
    return val in ("1", "true", "yes", "on")


# Time budgets (milliseconds)
ANALYZE_BUDGET_MS = get_int_env("ANALYZE_BUDGET_MS", 38000)  # 38s for analyze
PREDICT_BUDGET_MS = get_int_env("PREDICT_BUDGET_MS", 55000)  # 55s for predict
PER_CALL_TIMEOUT_MS = get_int_env("PER_CALL_TIMEOUT_MS", 12000)  # 12s per upstream call

# Retry configuration
JSON_RETRIES = get_int_env("JSON_RETRIES", 2)  # Max retries for JSON parse failures
BACKOFF_BASE_MS = get_int_env("BACKOFF_BASE_MS", 250)  # Base backoff delay
BACKOFF_FACTOR = float(os.getenv("BACKOFF_FACTOR", "1.8"))  # Exponential factor
BACKOFF_JITTER_MAX_MS = get_int_env("BACKOFF_JITTER_MAX_MS", 120)  # Random jitter

# Provider preferences
PROVIDER_PREFS = os.getenv("PROVIDER_PREFS", "openai,tesseract,stub").split(",")

# Feature flags
USE_FALLBACK_CHAINS = get_bool_env("USE_FALLBACK_CHAINS", True)
STRICT_JSON_ONLY = get_bool_env("STRICT_JSON_ONLY", True)
TICKET_ONLY_MODE = get_bool_env("TICKET_ONLY_MODE", True)  # Default to ticket-only

# Vercel limits
VERCEL_FUNCTION_MAX_MS = 60000  # Hard 60s limit

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

