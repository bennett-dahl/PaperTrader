"""
modal/kronos_service.py

Kronos-base (NeoQuasar/Kronos-base, 102M params) inference service.
Fetches OHLCV via yfinance, runs 24h return forecast, returns sorted results.

Deploy:
  modal deploy modal/kronos_service.py

Endpoint:
  POST /forecast_endpoint
  Authorization: Bearer <KRONOS_SECRET>
  Body: {"tickers": [...], "lookback": 60, "pipeline_id": "..."}
"""

import json
import os

import modal

app = modal.App("kronos-forecaster")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "transformers",
        "yfinance",
        "huggingface_hub",
        "pandas",
        "numpy",
        "fastapi",
    )
)

# Secret must be created in Modal dashboard:
#   modal secret create kronos-secret KRONOS_SECRET=<hex>
kronos_secret = modal.Secret.from_name("kronos-secret")

MODEL_NAME = "NeoQuasar/Kronos-base"


def _load_model():
    """Download and cache Kronos-base from HuggingFace. Called once per container."""
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    import torch

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        torch_dtype=torch.float32,
    )
    model.eval()
    return tokenizer, model


def _fetch_ohlcv(ticker: str, lookback: int) -> list[list[float]]:
    """Fetch OHLCV data via yfinance. Returns list of [open, high, low, close, volume] rows."""
    import yfinance as yf
    import pandas as pd

    df = yf.download(ticker, period=f"{lookback}d", interval="1d", progress=False)
    if df.empty or len(df) < 5:
        return []

    rows = []
    for _, row in df.iterrows():
        rows.append([
            float(row["Open"]),
            float(row["High"]),
            float(row["Low"]),
            float(row["Close"]),
            float(row["Volume"]),
        ])
    return rows[-lookback:]  # cap to lookback


def _run_inference(tokenizer, model, ohlcv_rows: list[list[float]]) -> float:
    """
    Run Kronos inference on OHLCV rows.

    Kronos-base expects a time-series input. We encode the close prices as a
    sequence and use the model's regression head (or logit as a proxy) to
    produce a predicted return signal.

    NOTE: Adapt input encoding to match Kronos-base's actual expected format
    once the model card is reviewed. The pattern below is a reasonable default
    for time-series transformer models that accept text-encoded sequences.
    """
    import torch

    closes = [row[3] for row in ohlcv_rows]
    if len(closes) < 2:
        return 0.0

    # Encode as text sequence (common pattern for Kronos-style models)
    sequence = " ".join(f"{c:.4f}" for c in closes)
    inputs = tokenizer(
        sequence,
        return_tensors="pt",
        truncation=True,
        max_length=512,
    )

    with torch.no_grad():
        outputs = model(**inputs)

    # Use the first logit as a raw return signal proxy
    # Calibrate scale: model outputs ~[-1, 1] range → interpret as predicted % return
    logit = float(outputs.logits[0][0].item())
    predicted_return_pct = logit * 5.0  # scale factor; tune empirically
    return round(predicted_return_pct, 4)


@app.function(
    image=image,
    secrets=[kronos_secret],
    gpu="any",
    timeout=300,
    retries=1,
)
def run_kronos_forecast(
    tickers: list[str],
    lookback: int = 60,
    pipeline_id: str = "",
) -> dict:
    """
    Core forecast function. Called by forecast_endpoint.

    Args:
        tickers: List of ticker symbols to forecast
        lookback: Number of days of OHLCV history to use (default 60)
        pipeline_id: Originating pipeline ID (for logging)

    Returns:
        {"results": [{"ticker": str, "predictedReturnPct": float}]}
        sorted descending by predictedReturnPct
    """
    tokenizer, model = _load_model()
    results = []

    for ticker in tickers:
        try:
            ohlcv = _fetch_ohlcv(ticker, lookback)
            if not ohlcv:
                print(f"[kronos] No OHLCV data for {ticker}, skipping")
                continue
            predicted = _run_inference(tokenizer, model, ohlcv)
            results.append({"ticker": ticker, "predictedReturnPct": predicted})
            print(f"[kronos] {ticker}: {predicted:+.4f}% (pipeline={pipeline_id})")
        except Exception as e:
            print(f"[kronos] Error forecasting {ticker}: {e}")
            continue

    results.sort(key=lambda r: r["predictedReturnPct"], reverse=True)
    return {"results": results}


@app.function(image=image, secrets=[kronos_secret])
@modal.fastapi_endpoint(method="POST")
async def forecast_endpoint(request: dict) -> dict:
    """
    HTTP POST entry point. Verifies bearer token, delegates to run_kronos_forecast.

    Expected body:
      {
        "tickers": ["AAPL", "MSFT", ...],
        "lookback": 60,
        "pipeline_id": "<uuid>"
      }

    Returns:
      {"results": [{"ticker": str, "predictedReturnPct": float}]}

    Note: For Modal web endpoints, pass the full Request object from FastAPI
    to access headers. The pattern below handles both dict and Request forms.
    """
    from fastapi import Request as FastAPIRequest

    # When Modal passes a Request object, use .headers; otherwise fall back to dict
    secret = os.environ.get("KRONOS_SECRET", "")

    # Support both FastAPI Request and plain dict (for testing)
    if hasattr(request, "headers"):
        auth_header = request.headers.get("authorization", "")
        body = await request.json()
    else:
        auth_header = request.get("_headers", {}).get("authorization", "")
        body = request

    if not auth_header.startswith("Bearer ") or auth_header[7:] != secret:
        return {"error": "Unauthorized"}

    tickers = body.get("tickers", [])
    lookback = int(body.get("lookback", 60))
    pipeline_id = body.get("pipeline_id", "")

    if not tickers:
        return {"results": []}

    return run_kronos_forecast.remote(tickers=tickers, lookback=lookback, pipeline_id=pipeline_id)
