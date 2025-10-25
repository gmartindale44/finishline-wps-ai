import os
import traceback
from fastapi import FastAPI, Request
from openai import AsyncOpenAI

app = FastAPI()

# --- Load environment variables ---
OPENAI_MODEL = os.getenv("FINISHLINE_OPENAI_MODEL", "gpt-4o-mini")
OPENAI_KEY = os.getenv("FINISHLINE_OPENAI_API_KEY")

# --- Debug startup info ---
print("\n=== [FinishLine WPS AI - OCR Debug] ===")
if OPENAI_KEY:
    print(f"✅ FINISHLINE_OPENAI_API_KEY detected (prefix): {OPENAI_KEY[:7]}...")
else:
    print("❌ Missing FINISHLINE_OPENAI_API_KEY - OCR calls will fail.")
print(f"Using model: {OPENAI_MODEL}")
print("=======================================\n")

client = AsyncOpenAI(api_key=OPENAI_KEY)

@app.post("/api/photo_extract_openai_b64")
async def extract_text(request: Request):
    data = await request.json()
    image_b64 = data.get("image_b64")

    if not image_b64:
        print("⚠️ No image data received in request.")
        return {"error": "No image data provided."}

    try:
        print("[FinishLine OCR] Sending request to OpenAI...")
        response = await client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "You are an OCR assistant that extracts horse racing data from images (horse name, trainer, jockey, odds)."},
                {"role": "user", "content": f"Extract text from this image (base64): {image_b64}"}
            ],
        )
        print("[FinishLine OCR] ✅ Response received from OpenAI.")
        text_output = response.choices[0].message.content.strip()
        if not text_output:
            raise ValueError("Received empty OCR text from OpenAI response.")
        return {"text": text_output}

    except Exception as e:
        print("\n🚨 [FinishLine OCR ERROR] Exception during OCR request:")
        traceback.print_exc()
        return {"error": f"OpenAI OCR failed: {str(e)}"}