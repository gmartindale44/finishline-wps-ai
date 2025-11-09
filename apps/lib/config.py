import os

FINISHLINE_OPENAI_API_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY", "")
FINISHLINE_OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")

def boot_banner():
    print("\n🧠 [FinishLine OCR Boot] ====================================")
    print(f"Model: {FINISHLINE_OPENAI_MODEL}")
    print(f"Key loaded: {'✅' if bool(FINISHLINE_OPENAI_API_KEY) else '❌ MISSING'}")
    if FINISHLINE_OPENAI_API_KEY:
        print(f"Key prefix: {FINISHLINE_OPENAI_API_KEY[:8]}...")
    print("============================================================\n")
