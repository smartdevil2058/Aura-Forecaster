# Demand Forecasting System

A LightGBM-based sales/demand forecasting service for retail store-item combinations, served via a FastAPI backend with a static frontend. Includes both a REST API (`app/main.py`) and a standalone CLI predictor (`script/predict.py`).

## Overview

The system predicts daily **unit sales** for a given `(store_nbr, item_nbr, date)` combination, using historical sales, holiday calendar, and oil price data as features. The underlying model is a scikit-learn `Pipeline` (LightGBM regressor + preprocessing, including a `SimpleImputer`) trained on a log-transformed sales target and serialized with `joblib` as `Forecaster.pkl`.

## Model Performance

| Metric | Value |
|--------|-------|
| RMSE   | 0.832840 |
| MAE    | 0.432976 |
| R²     | 0.89 |

## Project Structure

```
Demand Forecasting/
├── app/
│   ├── static/
│   │   ├── app.js          
│   │   └── style.css       
│   ├── templates/
│   │   └── index.html      
│   └── main.py              
├── Data/
│   ├── data.csv              
│   ├── featured_data.parquet 
│   ├── holidays_events.csv   
│   ├── items.csv              
│   ├── oil.csv                 
│   ├── sample_submission.csv  
│   ├── stores.csv              
│   ├── test.csv                  
│   ├── train.csv
│   ├── train_red.csv
│   └── transactions.csv       
├── model/
│   └── Forecaster.pkl       
├── notebooks/                 
├── script/
│   └── predict.py
├── requirements.txt
└── README.md
```

> **Path resolution note:** `app/main.py` computes `BASE_DIR` as the parent of its own folder, then looks for the model at `BASE_DIR/model/Forecaster.pkl` and data at `BASE_DIR/Data/data.csv`. `script/predict.py` uses hardcoded relative paths `../model/Forecaster.pkl` and `../Data/data.csv`. Both assume `model/` and `Data/` are siblings of `app/`/`script/` at the project root, matching the structure above.

## Data

### `Data/data.csv` (used by the app)

This is the cleaned, merged dataset that `app/main.py` and `script/predict.py` actually load at runtime (~113 MB, ~1.09M rows). It appears to be a join of `train.csv`/`train_red.csv` with `items.csv`, `stores.csv`, `oil.csv`, `transactions.csv`, and `holidays_events.csv`. Columns:

| Column | Description |
|---|---|
| `id` | Row identifier |
| `date` | Sale date |
| `store_nbr` | Store identifier |
| `item_nbr` | Item identifier |
| `unit_sales` | Target variable — units sold |
| `onpromotion` | Whether the item was on promotion |
| `family`, `class`, `perishable` | Item metadata (from `items.csv`) |
| `city`, `state`, `type_x` (→ renamed `store_type`), `cluster` | Store metadata (from `stores.csv`) |
| `dcoilwtico` | Daily WTI oil price (from `oil.csv`) |
| `transactions` | Store transaction count that day (from `transactions.csv`) |
| `type_y` (→ renamed `holiday_type`), `locale`, `locale_name`, `description`, `transferred` | Holiday calendar info (from `holidays_events.csv`) |

On load, both `main.py` and `predict.py` apply identical cleaning:
- Rename `type_x` → `store_type`, `type_y` → `holiday_type`
- Fill missing `dcoilwtico` with the column median
- Fill missing `transactions` with `0`
- Fill missing holiday fields (`holiday_type`, `locale`, `locale_name`, `description`) with `"No Holiday"`
- Fill missing `transferred` with `False`
- Sort by `store_nbr`, `item_nbr`, `date`

A separate `oil_series` (one row per calendar date) is derived from `data.csv` for oil-price lookups/rolling stats.

### Raw source files

These are the original, unmerged files that `data.csv` was built from (standard structure for a Corporación Favorita–style grocery sales dataset). They aren't read directly by `main.py` or `predict.py` at runtime, but document the source data:

**`train.csv`** — full historical training data
| Column | Description |
|---|---|
| `id` | Row identifier |
| `date` | Sale date |
| `store_nbr` | Store identifier |
| `item_nbr` | Item identifier |
| `unit_sales` | Target — units sold (can be fractional/negative for returns) |
| `onpromotion` | Whether the item was on promotion that day |

**`train_red.csv`** — reduced/sampled version of `train.csv` (same schema), likely used for faster local iteration/training instead of the full file.

**`test.csv`** — holdout set for generating predictions, same schema as `train.csv` minus `unit_sales`.

**`items.csv`** — item catalog
| Column | Description |
|---|---|
| `item_nbr` | Item identifier (join key) |
| `family` | Product family/category (e.g. GROCERY I, CLEANING) |
| `class` | Product class code |
| `perishable` | Flag (0/1) indicating a perishable item |

**`stores.csv`** — store catalog
| Column | Description |
|---|---|
| `store_nbr` | Store identifier (join key) |
| `city` | City the store is located in |
| `state` | State/province |
| `type` | Store type/category (A–E), merged into `data.csv` as `store_type` |
| `cluster` | Cluster grouping of similar stores |

**`oil.csv`** — daily oil price
| Column | Description |
|---|---|
| `date` | Calendar date |
| `dcoilwtico` | WTI crude oil daily price (used as a macroeconomic signal) |

**`transactions.csv`** — daily store activity
| Column | Description |
|---|---|
| `date` | Calendar date |
| `store_nbr` | Store identifier |
| `transactions` | Number of transactions at that store on that date |

**`holidays_events.csv`** — holiday/event calendar
| Column | Description |
|---|---|
| `date` | Calendar date |
| `type` | Event type (Holiday, Transfer, Additional, Bridge, Work Day, Event), merged as `holiday_type` |
| `locale` | Scope of the holiday (National, Regional, Local) |
| `locale_name` | Specific locale name (country/state/city) it applies to |
| `description` | Text description of the holiday/event |
| `transferred` | Whether the holiday was moved to another date |

**`sample_submission.csv`** — submission template
| Column | Description |
|---|---|
| `id` | Row identifier matching `test.csv` |
| `unit_sales` | Placeholder prediction column |

**`featured_data.parquet`** — the output of the feature-engineering step (likely equivalent in content to the feature set produced by `create_features()`/the `Featuring` notebook, stored in Parquet for faster load during model training/experimentation).

> Note: exact contents of `train_red.csv` and `featured_data.parquet` are inferred from naming convention and project context — verify against the notebooks if precise provenance is needed.

## Feature Engineering (`script/predict.py`)

For a given `(store_nbr, item_nbr, date, onpromotion)`, `create_features()` builds a single-row feature vector:

- **Calendar features**: `year`, `month`, `week`, `day`, `dayofweek`, `dayofyear`, `quarter`, `is_weekend`, `is_month_start`, `is_month_end`
- **Lag features**: `lag_1`, `lag_7`, `lag_14`, `lag_28` (previous unit sales at those offsets)
- **Rolling sales stats** over 7/14/30-day windows: mean, std, max, min, median
- **Oil price features**: current price (`dcoilwtico`), day-over-day diff, and rolling mean/std/max/min/median over 7/14/30-day windows
- **Holiday features**: `holiday_type`, `locale`, `locale_name`, `transferred` (looked up for the exact date, defaulting to "No Holiday"/`False` if none)
- **Static store/item attributes**: `perishable`, `cluster`, `family`, `class`, `city`, `state`, `store_type`

`predict_sales()` runs the pipeline and applies `signed_inverse_log` (a signed `expm1`) to invert the log-transform used during training, returning a plain float prediction.

Categorical columns used by the pipeline's encoder:
```
store_nbr, item_nbr, family, class, city, state, store_type,
holiday_type, locale, locale_name
```

## Backend API (`app/main.py`)

Built with **FastAPI**. On startup it loads the model (with compatibility patches, see below), loads and cleans the full historical dataset, and precomputes store/item metadata for the frontend.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Serves the frontend (`templates/index.html`) |
| `GET` | `/static/*` | Static assets |
| `GET` | `/api/metadata` | Returns min/max dates in the dataset plus lists of known stores and items |
| `POST` | `/api/predict` | Single-point prediction for one store/item/date |
| `POST` | `/api/forecast` | Sequential multi-day forecast (1–31 days) plus recent (last 14 days) actual history for context |

#### `POST /api/predict`
Request body:
```json
{
  "store_nbr": 25,
  "item_nbr": 119187,
  "date": "2017-08-20",
  "onpromotion": false
}
```
Response includes the predicted unit sales (clipped at 0) and the full computed feature vector.

#### `POST /api/forecast`
Request body:
```json
{
  "store_nbr": 25,
  "item_nbr": 119187,
  "start_date": "2017-08-20",
  "days": 7,
  "onpromotion": false
}
```
Response includes the last 14 days of actual history before `start_date`, plus day-by-day forecasted values for the requested window. Note: each forecasted day is computed independently from the static `history` table (predictions are not fed back in as new lag inputs).

### Compatibility Shims

Because the model was trained on an older/different scikit-learn version, `main.py` applies two runtime patches before use:
1. Injects a dummy `_RemainderColsList` class into `sklearn.compose._column_transformer` if missing (for `ColumnTransformer` unpickling).
2. `patch_simple_imputer()` recursively walks the pipeline (`named_steps`, `transformers_`, `transformers`, `steps`) to add a missing `_fill_dtype` attribute to any `SimpleImputer` instance, so it can run under newer scikit-learn.

## CLI Predictor (`script/predict.py`)

Can also be run standalone for interactive, terminal-based predictions:

```bash
cd script
python predict.py
```

This loads `Forecaster.pkl` and `Data/data.csv` (paths hardcoded as `../model/Forecaster.pkl` and `../Data/data.csv`, relative to `script/`), then prompts interactively for store number, item number, date, and promotion status, printing a predicted unit-sales value. Type `n` when asked to make another prediction, or `Ctrl+C`, to exit.

## Setup & Installation

### 1. Clone / obtain the project
Ensure the folder layout matches the [Project Structure](#project-structure) above — `model/` and `Data/` must sit at the project root, alongside `app/` and `script/`.

### 2. Create a virtual environment
```bash
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

Minimum dependencies expected in `requirements.txt`:
```
fastapi
uvicorn[standard]
pandas
numpy
scikit-learn
lightgbm
joblib
pydantic
python-multipart
```

> Pin exact versions once your training environment is finalized (e.g. `pandas==2.x`, `scikit-learn==1.8.x`) to avoid the compatibility shims in `main.py` silently masking version drift.

### 4. Verify required files are present
- `model/Forecaster.pkl` — trained pipeline
- `Data/data.csv` — cleaned dataset

### 5. Run the API
```bash
cd app
uvicorn main:app --reload
```
Then visit `http://localhost:8000/` for the frontend.

### 6. Call the API directly (optional)
```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"store_nbr": 25, "item_nbr": 119187, "date": "2017-08-20", "onpromotion": false}'
```

## Known Limitations

- `/api/forecast` generates each day's prediction independently from historical `unit_sales` rather than chaining predicted values into subsequent lag features, so multi-day forecasts don't compound forecast error but also don't reflect a truly autoregressive rollout.
- `store_nbr`/`item_nbr` must already exist in the historical dataset; unseen IDs raise a `ValueError` (`400` from the API).
- The dataset is loaded fully into memory on startup (~113 MB CSV), so startup time and memory footprint scale with data size.
- Exact provenance of `train_red.csv` and `featured_data.parquet` should be confirmed against the training notebooks if this README needs to be authoritative for onboarding.
