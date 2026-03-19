# Test Coverage Analysis

## Current State

| Module | Statements | Missed | Branch | Coverage |
|---|---|---|---|---|
| `src/api_client.py` | 76 | 76 | 12 branches | **0%** |
| `src/data_processing.py` | 78 | 44 | 44 branches | **39%** |
| `src/auth.py` | 89 | 29 | 30 branches | **63%** |
| `src/cache.py` | 59 | 18 | 16 branches | **64%** |
| **Total** | **302** | **167** | **102 branches** | **42%** |

The configured threshold is **80%**. Current coverage fails that target by 38 points.

---

## Area 1: `api_client.py` — 0% coverage (highest priority)

The entire HTTP client layer is untested. This is the most critical gap because:

- Network code has many failure modes that are hard to reproduce manually.
- The retry logic (`RetryPolicy.delay_for`, the retry loop in `_request`) is completely unexercised.
- `APIError` is never raised in a test, so callers have no verified contract for error handling.

**Recommended tests to add:**

1. **`RetryPolicy` unit tests**
   - `delay_for` returns correct exponential values (attempt 0 → `backoff * 1`, attempt 1 → `backoff * 2`, …).
   - Constructor rejects `max_retries < 0`.
   - Default `retry_on` tuple contains the expected status codes.

2. **`APIClient._build_url` unit tests** (pure function, no mocking needed)
   - Trailing slash on `base_url` is stripped.
   - Query params are URL-encoded and appended correctly.
   - Path leading slash is handled.

3. **`APIClient` integration tests with a mock HTTP server** (use `unittest.mock.patch` on `urllib.request.urlopen`)
   - Successful GET returns parsed JSON body.
   - Successful POST sends JSON-encoded body and returns response.
   - PUT and DELETE are exercised.
   - `HTTPError` with a retryable status code (e.g. 503) triggers retries up to `max_retries`.
   - `HTTPError` with a non-retryable status code (e.g. 404) raises `APIError` immediately without retry.
   - `URLError` (network failure) triggers retries and ultimately re-raises.
   - Response with empty body returns `None`.
   - Response body JSON parse error is handled gracefully.

4. **`APIError` tests**
   - `status_code`, `message`, and `body` attributes are set correctly.
   - `str(error)` produces the expected `"HTTP NNN: ..."` format.

---

## Area 2: `data_processing.py` — 39% coverage

Six of the eleven functions have **zero tests**. The tested functions also have branch gaps.

**Untested functions (0% each):**

| Function | Risk |
|---|---|
| `group_by` | Edge cases: empty list, non-hashable key return |
| `normalize` | Boundary: all-identical values (division guarded but untested), empty list |
| `parse_csv_row` | Complex logic: quoted fields containing the delimiter, escaped quotes, custom delimiter |
| `merge_dicts` | Two modes: shallow merge (overwrite) vs. deep recursive merge |
| `transform_records` | Field absent in record (key lookup), transformation raises exception |

**Branch gaps in existing tests:**

- `chunk`: `size <= 0` path raises `ValueError` — not tested.
- `deduplicate`: `key` function argument is never exercised; empty list is not tested.
- `safe_divide`: custom `default` value, negative numbers, and float inputs are untested.
- `compute_stats`: empty-list `ValueError` path is missing; all-identical values (stdev edge case) is not tested.

**Recommended additions (in priority order):**

1. `TestParseCsvRow` — the quoting state machine is the most complex logic in the file and the easiest place for a subtle bug to hide.
2. `TestMergeDicts` — `deep=True` recursive merge with nested conflicts needs explicit verification.
3. `TestNormalize` — the `lo == hi` guard (returns all zeros) is a silent correctness issue without a test.
4. Fill branch gaps in `chunk`, `deduplicate`, `safe_divide`, and `compute_stats` as described above.

---

## Area 3: `auth.py` — 63% coverage

Security-critical code deserves the highest coverage standards. Two entire functions and several security branches are untested.

**Critical untested paths:**

1. **Account lockout** (`_is_locked_out` / `_record_failed_attempt`) — The 5-attempt, 5-minute lockout is a core security control with zero test coverage. Tests needed:
   - Five consecutive wrong passwords lock the account.
   - Sixth attempt raises `PermissionError`.
   - Successful login clears the failed-attempt counter.
   - Attempts older than 5 minutes are not counted (requires `time.monotonic` mocking or `time.time` patching).

2. **`generate_token` / `verify_token`** — Not tested at all. Tests needed:
   - `generate_token` returns a 3-part colon-separated string.
   - `verify_token` returns the correct `user_id` for a fresh token.
   - `verify_token` returns `None` for an expired token (mock `time.time`).
   - `verify_token` returns `None` for a tampered signature.
   - `verify_token` returns `None` for a malformed token (wrong number of parts).
   - Different secrets produce different tokens.

3. **`UserStore` edge cases:**
   - `register` with a weak password raises `ValueError`.
   - `register` with an empty username or password raises `ValueError`.
   - `deactivate` on an unknown user raises `KeyError`.
   - `authenticate` on a deactivated user returns `False`.
   - `authenticate` on an unknown username returns `False` (not an exception).

4. **`validate_email` edge cases:**
   - Plus-addressed email (`user+tag@example.com`) is valid.
   - Empty string is invalid.
   - Missing TLD is invalid.
   - Subdomain (`user@mail.example.co.uk`) is valid.

---

## Area 4: `cache.py` — 64% coverage

The core LRU eviction behaviour and TTL expiry — the two properties that define the class — are not tested.

**Critical untested paths:**

1. **LRU eviction** — When `max_size` is reached, the least-recently-used key must be evicted. This is entirely untested.
   ```
   cache = LRUCache(max_size=2)
   cache.set("a", 1); cache.set("b", 2)
   cache.get("a")          # promote "a" to MRU
   cache.set("c", 3)       # should evict "b", not "a"
   assert cache.get("b") is None
   assert cache.get("a") == 1
   ```

2. **TTL expiry** — `CacheEntry.is_expired()` and the expiry check inside `LRUCache.get` are untested. Requires patching `time.monotonic`.

3. **`delete` and `clear`** — Both methods are untested.

4. **`CacheEntry` directly** — `is_expired()` with `expires_at=None` (no expiry) vs. a past timestamp is not tested as a unit.

5. **Thread safety** — The `Lock` is present but concurrent-access correctness is never verified. A basic test using `threading.Thread` with many simultaneous writers would catch race conditions.

6. **`max_size=0`** raises `ValueError` — untested.

---

## Summary: Recommended Priority Order

| Priority | Action | Expected coverage gain |
|---|---|---|
| 1 | Add `TestAPIClient` with mocked HTTP layer | +25 pp |
| 2 | Add lockout + token tests in `test_auth.py` | +10 pp |
| 3 | Add `TestParseCsvRow`, `TestMergeDicts`, `TestNormalize` | +8 pp |
| 4 | Add LRU eviction + TTL tests in `test_cache.py` | +6 pp |
| 5 | Fill branch gaps across all modules | +5 pp |

Completing priorities 1–3 alone should bring total coverage from **42% to ~90%**, clearing the 80% threshold.

---

## Tooling Recommendations

- Run `pytest --cov=src --cov-report=html` to generate a browsable HTML report showing exactly which lines are missed.
- Add `pytest-cov` to CI and enforce `fail_under = 80` (already configured in `setup.cfg`).
- For time-dependent tests (`lockout`, `token expiry`), use `unittest.mock.patch("time.time", return_value=...)` rather than sleeping, to keep tests fast and deterministic.
