import os, traceback
from fastapi import FastAPI, Request
from openai import AsyncOpenAI

app = FastAPI()

# Load env
OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")
OPENAI_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY")

print("\n🧠 [FinishLine OCR Boot] ====================================")
print(f"Model: {OPENAI_MODEL}")
print(f"Key loaded: {'✅' if OPENAI_KEY else '❌ MISSING'}")
if OPENAI_KEY:
    print(f"Key prefix: {OPENAI_KEY[:8]}...")
print("=============================================================\n")

client = AsyncOpenAI(api_key=OPENAI_KEY)

@app.post("/api/photo_extract_openai_b64")
async def extract_text(request: Request):
    data = await request.json()
    image_b64 = data.get("image_b64")

    if not image_b64:
        return {"error": "No image data provided."}

    try:
        print("[FinishLine OCR] Sending to OpenAI…")
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "You are an OCR assistant that extracts horse race data (name, trainer, jockey, odds) from images."},
                {"role": "user", "content": f"Extract text from this base64 image:\n{image_b64}"}
            ],
        )
        text = response.choices[0].message.content.strip()
        print("[FinishLine OCR] ✅ Received response.")
        if not text:
            raise ValueError("Empty OCR response from OpenAI.")
        return {"text": text}

    except Exception as e:
        err_msg = str(e)
        print("🚨 [FinishLine OCR ERROR]", err_msg)
        traceback.print_exc()

        # Optional fallback
        if "model" in err_msg or "not found" in err_msg or "Invalid model" in err_msg:
            print("[FinishLine OCR] Retrying with model=gpt-4o …")
            try:
                response = await client.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": "You are an OCR assistant that extracts horse race data (name, trainer, jockey, odds) from images."},
                        {"role": "user", "content": f"Extract text from this base64 image:\n{image_b64}"}
                    ],
                )
                text = response.choices[0].message.content.strip()
                print("[FinishLine OCR] ✅ Fallback succeeded.")
                return {"text": text}
            except Exception as inner:
                print("❌ [FinishLine OCR Fallback Failed]", str(inner))
                traceback.print_exc()
                return {"error": f"OCR failed on fallback: {inner}"}

        return {"error": f"OCR failed: {err_msg}"}