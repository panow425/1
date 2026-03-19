"""Data processing and transformation utilities."""
from typing import Any, Callable, Iterator
import statistics


def chunk(iterable: list, size: int) -> Iterator[list]:
    """Split a list into chunks of the given size."""
    if size <= 0:
        raise ValueError("Chunk size must be positive.")
    for i in range(0, len(iterable), size):
        yield iterable[i : i + size]


def flatten(nested: list) -> list:
    """Recursively flatten a nested list."""
    result = []
    for item in nested:
        if isinstance(item, list):
            result.extend(flatten(item))
        else:
            result.append(item)
    return result


def deduplicate(items: list, key: Callable = None) -> list:
    """Remove duplicates while preserving order."""
    seen = set()
    result = []
    for item in items:
        k = key(item) if key else item
        if k not in seen:
            seen.add(k)
            result.append(item)
    return result


def group_by(items: list, key: Callable) -> dict:
    """Group items by a key function."""
    groups: dict = {}
    for item in items:
        k = key(item)
        if k not in groups:
            groups[k] = []
        groups[k].append(item)
    return groups


def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """Divide, returning default on zero division."""
    if denominator == 0:
        return default
    return numerator / denominator


def compute_stats(values: list[float]) -> dict[str, float]:
    """Compute basic descriptive statistics for a list of numbers."""
    if not values:
        raise ValueError("Cannot compute stats on empty list.")
    return {
        "count": len(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "stdev": statistics.stdev(values) if len(values) > 1 else 0.0,
        "min": min(values),
        "max": max(values),
    }


def normalize(values: list[float]) -> list[float]:
    """Min-max normalize a list of values to [0, 1]."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if lo == hi:
        return [0.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def parse_csv_row(row: str, delimiter: str = ",") -> list[str]:
    """Parse a CSV row, handling quoted fields."""
    fields = []
    current = []
    in_quotes = False
    for ch in row:
        if ch == '"':
            in_quotes = not in_quotes
        elif ch == delimiter and not in_quotes:
            fields.append("".join(current).strip())
            current = []
        else:
            current.append(ch)
    fields.append("".join(current).strip())
    return fields


def merge_dicts(*dicts: dict, deep: bool = False) -> dict:
    """Merge multiple dicts; later values overwrite earlier ones."""
    result: dict = {}
    for d in dicts:
        if deep:
            for k, v in d.items():
                if k in result and isinstance(result[k], dict) and isinstance(v, dict):
                    result[k] = merge_dicts(result[k], v, deep=True)
                else:
                    result[k] = v
        else:
            result.update(d)
    return result


def transform_records(
    records: list[dict], transformations: dict[str, Callable]
) -> list[dict]:
    """Apply field-level transformations to a list of record dicts."""
    result = []
    for record in records:
        new_record = dict(record)
        for field, fn in transformations.items():
            if field in new_record:
                new_record[field] = fn(new_record[field])
        result.append(new_record)
    return result
