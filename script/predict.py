
import numpy as np
import pandas as pd
import joblib

MODEL_PATH = r"../model/Forecaster.pkl"
DATA_PATH = r"../Data/data.csv"
CAT_COLS = [
    "store_nbr", "item_nbr", "family", "class",
    "city", "state", "store_type",
    "holiday_type", "locale", "locale_name",
]

LAG_DAYS = [1, 7, 14, 28]
ROLL_WINDOWS = [7, 14, 30]

def load_history(data_path: str = DATA_PATH):

    print("Loading historical data (this can take a little while)...")
    df = pd.read_csv(data_path, parse_dates=["date"], low_memory=False)
    df = df.rename(columns={"type_x": "store_type", "type_y": "holiday_type"})

    df["dcoilwtico"] = df["dcoilwtico"].fillna(df["dcoilwtico"].median())
    df["transactions"] = df["transactions"].fillna(0)
    df["holiday_type"] = df["holiday_type"].fillna("No Holiday")
    df["locale"] = df["locale"].fillna("No Holiday")
    df["locale_name"] = df["locale_name"].fillna("No Holiday")
    df["description"] = df["description"].fillna("No Holiday")
    df["transferred"] = df["transferred"].fillna(False)

    df = df.sort_values(["store_nbr", "item_nbr", "date"]).reset_index(drop=True)

    # a compact date -> oil price lookup (one row per calendar date)
    oil_series = (
        df[["date", "dcoilwtico"]]
        .drop_duplicates(subset="date")
        .sort_values("date")
        .reset_index(drop=True)
    )
    print(f"Loaded {len(df):,} rows spanning {df['date'].min().date()} to {df['date'].max().date()}.")
    return df, oil_series


# ---------------------------------------------------------------------------
# 1. FEATURE CREATION
# ---------------------------------------------------------------------------
def create_features(history: pd.DataFrame, oil_series: pd.DataFrame,store_nbr: int, item_nbr: int, date, onpromotion: bool) -> pd.DataFrame:

    date = pd.to_datetime(date)

    store_rows = history.loc[history["store_nbr"] == store_nbr]
    if store_rows.empty:
        raise ValueError(f"store_nbr {store_nbr} was never seen in the historical data.")
    store_row = store_rows.iloc[0]

    item_rows = history.loc[history["item_nbr"] == item_nbr]
    if item_rows.empty:
        raise ValueError(f"item_nbr {item_nbr} was never seen in the historical data.")
    item_row = item_rows.iloc[0]

    holiday_rows = history.loc[history["date"] == date]
    if not holiday_rows.empty:
        holiday_row = holiday_rows.iloc[0]
        holiday_type = holiday_row["holiday_type"]
        locale = holiday_row["locale"]
        locale_name = holiday_row["locale_name"]
        transferred = bool(holiday_row["transferred"])
    else:
        holiday_type, locale, locale_name, transferred = "No Holiday", "No Holiday", "No Holiday", False

    year = date.year
    month = date.month
    week = int(date.isocalendar().week)
    day = date.day
    dayofweek = date.dayofweek
    dayofyear = date.dayofyear
    quarter = date.quarter
    is_weekend = int(dayofweek >= 5)
    is_month_start = int(date.is_month_start)
    is_month_end = int(date.is_month_end)

    group = history.loc[
        (history["store_nbr"] == store_nbr)
        & (history["item_nbr"] == item_nbr)
        & (history["date"] < date)
    ].sort_values("date")

    sales_hist = group["unit_sales"].to_numpy()

    def lag_value(k):
        return sales_hist[-k] if len(sales_hist) >= k else np.nan

    lag_features = {f"lag_{k}": lag_value(k) for k in LAG_DAYS}

    def rolling_stats(window):
        window_vals = sales_hist[-window:] if len(sales_hist) > 0 else np.array([])
        stats = {}
        if len(window_vals) > 0:
            stats[f"rolling_mean_{window}"] = np.mean(window_vals)
            stats[f"rolling_std_{window}"] = np.std(window_vals, ddof=1) if len(window_vals) > 1 else np.nan
            stats[f"rolling_max_{window}"] = np.max(window_vals)
            stats[f"rolling_min_{window}"] = np.min(window_vals)
            stats[f"rolling_median_{window}"] = np.median(window_vals)
        else:
            for stat in ["mean", "std", "max", "min", "median"]:
                stats[f"rolling_{stat}_{window}"] = np.nan
        return stats

    rolling_features = {}
    for w in ROLL_WINDOWS:
        rolling_features.update(rolling_stats(w))

    prior_oil = oil_series.loc[oil_series["date"] <= date]
    if not prior_oil.empty:
        current_oil = prior_oil.iloc[-1]["dcoilwtico"]
    else:
        current_oil = oil_series["dcoilwtico"].median()

    oil_hist_rows = oil_series.loc[oil_series["date"] < date].sort_values("date")
    oil_hist = oil_hist_rows["dcoilwtico"].to_numpy()

    if len(oil_hist) >= 2:
        oil_two_days_diff = current_oil - oil_hist[-2]
    else:
        oil_two_days_diff = np.nan

    def oil_rolling_stats(window):
        window_vals = oil_hist[-window:] if len(oil_hist) > 0 else np.array([])
        stats = {}
        if len(window_vals) > 0:
            stats[f"oil_mean_{window}"] = np.mean(window_vals)
            stats[f"oil_std_{window}"] = np.std(window_vals, ddof=1) if len(window_vals) > 1 else np.nan
            stats[f"oil_max_{window}"] = np.max(window_vals)
            stats[f"oil_min_{window}"] = np.min(window_vals)
            stats[f"oil_median_{window}"] = np.median(window_vals)
        else:
            for stat in ["mean", "std", "max", "min", "median"]:
                stats[f"oil_{stat}_{window}"] = np.nan
        return stats

    oil_features = {}
    for w in ROLL_WINDOWS:
        oil_features.update(oil_rolling_stats(w))

    row = {
        "onpromotion": bool(onpromotion),
        "perishable": item_row["perishable"],
        "cluster": store_row["cluster"],
        "dcoilwtico": current_oil,
        "transferred": transferred,
        "year": year,
        "month": month,
        "week": week,
        "day": day,
        "dayofweek": dayofweek,
        "dayofyear": dayofyear,
        "quarter": quarter,
        "is_weekend": is_weekend,
        "is_month_start": is_month_start,
        "is_month_end": is_month_end,
        **lag_features,
        **rolling_features,
        "oil_two_days_diff": oil_two_days_diff,
        **oil_features,
        "store_nbr": store_nbr,
        "item_nbr": item_nbr,
        "family": item_row["family"],
        "class": item_row["class"],
        "city": store_row["city"],
        "state": store_row["state"],
        "store_type": store_row["store_type"],
        "holiday_type": holiday_type,
        "locale": locale,
        "locale_name": locale_name,
    }

    return pd.DataFrame([row])

def signed_inverse_log(x):

    return np.sign(x) * np.expm1(np.abs(x))


def predict_sales(pipeline, feature_row: pd.DataFrame) -> float:
    y_pred_t = pipeline.predict(feature_row)
    y_pred = signed_inverse_log(y_pred_t)
    return float(y_pred[0])


def prompt_int(msg):
    while True:
        val = input(msg).strip()
        try:
            return int(val)
        except ValueError:
            print("Please enter a whole number.")


def prompt_date(msg):
    while True:
        val = input(msg).strip()
        try:
            return pd.to_datetime(val)
        except Exception:
            print("Please enter a date like 2017-08-20 (YYYY-MM-DD).")


def prompt_bool(msg):
    while True:
        val = input(msg).strip().lower()
        if val in ("y", "yes", "true", "1"):
            return True
        if val in ("n", "no", "false", "0"):
            return False
        print("Please answer y/n.")


def get_user_input(pipeline, history, oil_series):
    """Interactive loop: ask the user for inputs, then predict."""
    print("\n=== Sales Forecaster ===")
    print("Enter the details for the prediction you want (Ctrl+C to quit).\n")

    while True:
        store_nbr = prompt_int("Store number: ")
        item_nbr = prompt_int("Item number: ")
        date = prompt_date("Date (YYYY-MM-DD): ")
        onpromotion = prompt_bool("On promotion? (y/n): ")

        try:
            features = create_features(history, oil_series, store_nbr, item_nbr, date, onpromotion)
            prediction = predict_sales(pipeline, features)
            print(f"\nPredicted unit sales for store {store_nbr}, item {item_nbr} on "f"{date.date()}: {prediction:,.2f}\n")
        except ValueError as e:
            print(f"\nCould not predict: {e}\n")

        again = input("Make another prediction? (y/n): ").strip().lower()
        if again not in ("y", "yes"):
            print("Goodbye!")
            break


def main():
    pipeline = joblib.load(MODEL_PATH)
    history, oil_series = load_history(DATA_PATH)
    get_user_input(pipeline, history, oil_series)


if __name__ == "__main__":
    main()
