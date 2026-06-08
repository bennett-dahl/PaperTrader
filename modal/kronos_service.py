"""
Kronos-base inference service for PaperTrader.

Fetches OHLCV data via yfinance, runs Kronos-base forecasting using the
official KronosPredictor API, and returns ranked 24h predicted returns.
"""

import os
import modal

app = modal.App("kronos-forecaster")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "torch",
        "transformers",
        "yfinance",
        "huggingface_hub",
        "pandas",
        "numpy",
        "fastapi",
        "einops",
    )
    .run_commands(
        "git clone https://github.com/shiyu-coder/Kronos.git /kronos",
        "pip install -r /kronos/requirements.txt || true",
    )
)

kronos_secret = modal.Secret.from_name("kronos-secret")

MODEL_NAME = "NeoQuasar/Kronos-base"
TOKENIZER_NAME = "NeoQuasar/Kronos-Tokenizer-base"


@app.function(
    image=image,
    secrets=[kronos_secret],
    gpu="any",
    timeout=300,
)
def run_kronos_forecast(tickers: list, lookback: int = 60, pipeline_id: str = "") -> dict:
    """
    Run Kronos-base forecasting for a list of tickers.
    Returns results sorted by predictedReturnPct descending.
    """
    import sys
    import pandas as pd
    import yfinance as yf
    import numpy as np
    from datetime import datetime, timedelta

    # Add Kronos repo to path
    sys.path.insert(0, "/kronos")
    from model import Kronos, KronosTokenizer, KronosPredictor

    print(f"[kronos] Loading model: {MODEL_NAME}")
    tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_NAME)
    model = Kronos.from_pretrained(MODEL_NAME)
    predictor = KronosPredictor(model, tokenizer, max_context=512)
    print("[kronos] Model loaded")

    results = []
    today = datetime.utcnow().date()
    predict_date = today + timedelta(days=1)

    for ticker in tickers:
        try:
            print(f"[kronos] Fetching OHLCV for {ticker}")
            df = yf.download(ticker, period=f"{lookback}d", interval="1d", progress=False, auto_adjust=True)
            if df.empty or len(df) < 5:
                print(f"[kronos] Insufficient data for {ticker}")
                continue

            # Flatten multi-index columns from yfinance (e.g. ('Close','AAPL') -> 'close')
            df.columns = [c[0].lower() if isinstance(c, tuple) else c.lower() for c in df.columns]
            df = df[["open", "high", "low", "close"]].dropna()
            df.index = pd.to_datetime(df.index)
            timestamps = pd.Series(df.index)
            df = df.reset_index(drop=True)

            x_timestamp = timestamps
            
            # Predict next 1 day
            last_ts = x_timestamp.iloc[-1]
            y_timestamp = pd.Series([last_ts + pd.Timedelta(days=1)])

            pred = predictor.predict(
                df=df[["open", "high", "low", "close"]],
                x_timestamp=x_timestamp,
                y_timestamp=y_timestamp,
                pred_len=1,
            )

            # pred should be a DataFrame or array with predicted close price
            if hasattr(pred, "values"):
                pred_close = float(pred.values.flatten()[0])
            else:
                pred_close = float(np.array(pred).flatten()[0])

            current_close = float(df["close"].iloc[-1])
            predicted_return_pct = ((pred_close - current_close) / current_close) * 100

            print(f"[kronos] {ticker}: current={current_close:.2f} predicted={pred_close:.2f} return={predicted_return_pct:+.4f}%")
            results.append({"ticker": ticker, "predictedReturnPct": round(predicted_return_pct, 4)})

        except Exception as e:
            print(f"[kronos] Error forecasting {ticker}: {e}")
            import traceback
            traceback.print_exc()
            continue

    results.sort(key=lambda r: r["predictedReturnPct"], reverse=True)
    return {"results": results}


@app.function(image=image, secrets=[kronos_secret])
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    web_app = FastAPI()

    @web_app.post("/")
    async def forecast(request: Request):
        secret = os.environ.get("KRONOS_SECRET", "")
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer ") or auth_header[7:] != secret:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        body = await request.json()
        tickers = body.get("tickers", [])
        lookback = int(body.get("lookback", 60))
        pipeline_id = body.get("pipeline_id", "")
        if not tickers:
            return {"results": []}
        return run_kronos_forecast.remote(tickers=tickers, lookback=lookback, pipeline_id=pipeline_id)

    return web_app
