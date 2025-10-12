"""
Shared settings for FinishLine WPS AI.
Controls provider selection and production safety.
"""
import os

def env_bool(name: str, default: bool=False) -> bool:
    val = os.getenv(name, "").strip().lower()
    if val in ("1","true","yes","on"): return True
    if val in ("0","false","no","off"): return False
    return default

class Settings:
    VERCEL_ENV = os.getenv("VERCEL_ENV", "").lower()  # "production" | "preview" | "development"
    OCR_PROVIDER = os.getenv("OCR_PROVIDER", "openai").lower()  # "openai" | "tesseract" | "web" | "stub"
    OCR_DEBUG = env_bool("OCR_DEBUG", False)
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "") or os.getenv("FINISHLINE_OPENAI_API_KEY", "")
    MAX_IMAGES = int(os.getenv("OCR_MAX_IMAGES", "6"))
    
    # Timeouts (already handled on frontend; keep for reference)
    ANALYZE_TIMEOUT_SEC = int(os.getenv("ANALYZE_TIMEOUT_SEC", "30"))
    PREDICT_TIMEOUT_SEC = int(os.getenv("PREDICT_TIMEOUT_SEC", "50"))
    
    @property
    def is_prod(self) -> bool:
        return self.VERCEL_ENV == "production"
    
    @property
    def stub_allowed(self) -> bool:
        """Stub is only allowed in non-production environments"""
        return not self.is_prod

# Singleton instance
settings = Settings()
