import os
import sys
import joblib
import pandas as pd
import numpy as np
import logging
from typing import Optional

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DemandForecastingBackend")

# 1. APPLY SCIKIT-LEARN 1.8+ COMPATIBILITY SHIMS
import sklearn.compose._column_transformer as _ct
if not hasattr(_ct, "_RemainderColsList"):
    _ct._RemainderColsList = type("_RemainderColsList", (), {})
    logger.info("Applied sklearn _RemainderColsList compatibility shim.")

from sklearn.impute import SimpleImputer
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel

# Calculate paths relative to this file
APP_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(APP_DIR)
MODEL_PATH = os.path.join(BASE_DIR, "model", "Forecaster.pkl")
DATA_PATH = os.path.join(BASE_DIR, "Data", "data.csv")

sys.path.append(BASE_DIR)
from script.predict import create_features, predict_sales

# Recursive SimpleImputer patcher
def patch_simple_imputer(model):
    """Recursively patches SimpleImputer instances in the loaded sklearn model to add _fill_dtype."""
    if hasattr(model, "named_steps"):
        for step in model.named_steps.values():
            patch_simple_imputer(step)
    elif hasattr(model, "transformers_"):
        for trans in model.transformers_:
            if len(trans) >= 2:
                patch_simple_imputer(trans[1])
    elif hasattr(model, "transformers"):
        for trans in model.transformers:
            if len(trans) >= 2:
                patch_simple_imputer(trans[1])
    elif hasattr(model, "steps"):
        for name, step in model.steps:
            patch_simple_imputer(step)
    elif isinstance(model, SimpleImputer):
        if not hasattr(model, "_fill_dtype"):
            # Assign _fit_dtype or fallback to appropriate type based on strategy
            model._fill_dtype = getattr(model, "_fit_dtype", np.float64)
            logger.info(f"Patched SimpleImputer with _fill_dtype: {model._fill_dtype}")

# Global references
pipeline = None
history = None
oil_series = None
stores_metadata_list = []
items_metadata_list = []
min_date_str = ""
max_date_str = ""

app = FastAPI(
    title="Demand Forecasting System API",
    description="Backend API serving predictions and analytics using LightGBM",
    version="1.0.0"
)

# Request Models
class PredictionRequest(BaseModel):
    store_nbr: int
    item_nbr: int
    date: str
    onpromotion: bool

class ForecastRequest(BaseModel):
    store_nbr: int
    item_nbr: int
    start_date: str
    days: int = 7
    onpromotion: bool = False

@app.on_event("startup")
async def startup_event():
    global pipeline, history, oil_series
    global stores_metadata_list, items_metadata_list, min_date_str, max_date_str
    
    logger.info("Starting up Demand Forecasting Backend Server...")
    
    # Load Model
    if not os.path.exists(MODEL_PATH):
        logger.error(f"Model file not found at: {MODEL_PATH}")
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
    
    logger.info(f"Loading pipeline from {MODEL_PATH}...")
    pipeline = joblib.load(MODEL_PATH)
    patch_simple_imputer(pipeline)
    logger.info("Pipeline loaded and patched successfully.")

    # Load Data
    if not os.path.exists(DATA_PATH):
        logger.error(f"Dataset not found at: {DATA_PATH}")
        raise FileNotFoundError(f"Dataset not found: {DATA_PATH}")
        
    logger.info(f"Loading historical data from {DATA_PATH} (113MB)...")
    
    # Load history using same structure as predict.py
    df = pd.read_csv(DATA_PATH, parse_dates=["date"], low_memory=False)
    df = df.rename(columns={"type_x": "store_type", "type_y": "holiday_type"})

    df["dcoilwtico"] = df["dcoilwtico"].fillna(df["dcoilwtico"].median())
    df["transactions"] = df["transactions"].fillna(0)
    df["holiday_type"] = df["holiday_type"].fillna("No Holiday")
    df["locale"] = df["locale"].fillna("No Holiday")
    df["locale_name"] = df["locale_name"].fillna("No Holiday")
    df["description"] = df["description"].fillna("No Holiday")
    df["transferred"] = df["transferred"].fillna(False)

    df = df.sort_values(["store_nbr", "item_nbr", "date"]).reset_index(drop=True)

    oil_series = (
        df[["date", "dcoilwtico"]]
        .drop_duplicates(subset="date")
        .sort_values("date")
        .reset_index(drop=True)
    )
    
    history = df
    
    # Compute metadata lists
    logger.info("Compiling store and item metadata...")
    min_date_str = df["date"].min().strftime("%Y-%m-%d")
    max_date_str = df["date"].max().strftime("%Y-%m-%d")
    
    stores_df = df[["store_nbr", "city", "state", "store_type", "cluster"]].drop_duplicates(subset="store_nbr").sort_values("store_nbr")
    stores_metadata_list = stores_df.to_dict(orient="records")
    
    items_df = df[["item_nbr", "family", "class", "perishable"]].drop_duplicates(subset="item_nbr").sort_values("item_nbr")
    items_metadata_list = items_df.to_dict(orient="records")
    
    logger.info(f"Loaded {len(history):,} rows spanning {min_date_str} to {max_date_str}.")
    logger.info(f"Metadata compiled: {len(stores_metadata_list)} stores, {len(items_metadata_list)} items.")

# Set up static mounting
app.mount("/static", StaticFiles(directory=os.path.join(APP_DIR, "static")), name="static")

@app.get("/", response_class=FileResponse)
async def read_root():
    return FileResponse(os.path.join(APP_DIR, "templates", "index.html"))

@app.get("/api/metadata")
async def get_metadata():
    """Retrieve unique stores, items, and date range metadata for frontend autocomplete/context."""
    if history is None:
        raise HTTPException(status_code=503, detail="Server is still loading data. Please wait.")
    return {
        "min_date": min_date_str,
        "max_date": max_date_str,
        "stores": stores_metadata_list,
        "items": items_metadata_list
    }

@app.post("/api/predict")
async def predict_single(req: PredictionRequest):
    """Run a single point prediction using LightGBM."""
    if history is None or pipeline is None:
        raise HTTPException(status_code=503, detail="Server is still loading model or data.")
        
    try:
        date_parsed = pd.to_datetime(req.date)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
        
    try:
        # Create features using predict.py logic
        features_df = create_features(
            history, 
            oil_series, 
            store_nbr=req.store_nbr, 
            item_nbr=req.item_nbr, 
            date=date_parsed, 
            onpromotion=req.onpromotion
        )
        
        # Predict sales
        pred = predict_sales(pipeline, features_df)
        pred_clipped = max(0.0, pred)
        
        # Extract features as dict
        feature_dict = features_df.iloc[0].to_dict()
        
        # Convert non-JSON-serializable numpy/pandas values
        clean_features = {}
        for k, v in feature_dict.items():
            if isinstance(v, (np.integer, np.int64)):
                clean_features[k] = int(v)
            elif isinstance(v, (np.floating, np.float64)):
                clean_features[k] = float(v) if not np.isnan(v) else None
            elif isinstance(v, (pd.Timestamp, pd.DatetimeIndex)):
                clean_features[k] = v.strftime("%Y-%m-%d")
            else:
                clean_features[k] = v

        return {
            "store_nbr": req.store_nbr,
            "item_nbr": req.item_nbr,
            "date": req.date,
            "predicted_unit_sales": pred_clipped,
            "features": clean_features
        }
    except ValueError as e:
        logger.error(f"Value error during prediction: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error during prediction: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@app.post("/api/forecast")
async def predict_forecast(req: ForecastRequest):
    """Run sequential forecasting and fetch historical trend for comparison."""
    if history is None or pipeline is None:
        raise HTTPException(status_code=503, detail="Server is still loading model or data.")
        
    try:
        start_date_parsed = pd.to_datetime(req.start_date)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
        
    if req.days <= 0 or req.days > 31:
        raise HTTPException(status_code=400, detail="Forecast window must be between 1 and 31 days.")
        
    try:
        # 1. Fetch History
        hist_df = history.loc[
            (history["store_nbr"] == req.store_nbr)
            & (history["item_nbr"] == req.item_nbr)
            & (history["date"] < start_date_parsed)
        ].sort_values("date").tail(14)
        
        history_list = []
        for _, row in hist_df.iterrows():
            history_list.append({
                "date": row["date"].strftime("%Y-%m-%d"),
                "unit_sales": float(row["unit_sales"]),
                "onpromotion": bool(row["onpromotion"])
            })
            
        # 2. Generate Forecast Range
        forecast_list = []
        current_date = start_date_parsed
        
        for i in range(req.days):
            features_df = create_features(
                history, 
                oil_series, 
                store_nbr=req.store_nbr, 
                item_nbr=req.item_nbr, 
                date=current_date, 
                onpromotion=req.onpromotion
            )
            pred = predict_sales(pipeline, features_df)
            pred_clipped = max(0.0, pred)
            
            forecast_list.append({
                "date": current_date.strftime("%Y-%m-%d"),
                "predicted_unit_sales": pred_clipped,
                "onpromotion": req.onpromotion
            })
            current_date += pd.Timedelta(days=1)
            
        return {
            "store_nbr": req.store_nbr,
            "item_nbr": req.item_nbr,
            "start_date": req.start_date,
            "history": history_list,
            "forecast": forecast_list
        }
    except ValueError as e:
        logger.error(f"Value error during forecast: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error during forecast: {e}")
        raise HTTPException(status_code=500, detail=f"Forecasting failed: {str(e)}")
