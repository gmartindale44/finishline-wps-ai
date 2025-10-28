# Legacy API Files

This directory contains archived Python API functions that were replaced by JavaScript serverless functions for Vercel deployment.

These files are kept for reference only and are **NOT deployed** to Vercel.

## Archived Files

- `predict_wps.py` - Replaced by `api/predict_wps.js`
- `debug_fill.py` - Legacy debug utility (replaced by JS implementations)
- `research_predict.py` - Legacy research function (not used in production)

## Active API Functions

The active API functions in `/api` are:
- `/api/photo_extract_openai_b64.js` - OCR image extraction
- `/api/analyze.js` - Horse data analysis
- `/api/predict_wps.js` - Win/Place/Show prediction
- `/api/health.js` - Health check endpoint

These are deployed as Vercel serverless functions with Node.js runtime.
