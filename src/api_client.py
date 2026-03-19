"""HTTP API client with retry logic and response handling."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional


class APIError(Exception):
    """Raised when the API returns a non-2xx response."""

    def __init__(self, status_code: int, message: str, body: Any = None):
        self.status_code = status_code
        self.message = message
        self.body = body
        super().__init__(f"HTTP {status_code}: {message}")


class RetryPolicy:
    """Configuration for request retry behaviour."""

    def __init__(self, max_retries: int = 3, backoff_factor: float = 1.0, retry_on: tuple = (429, 500, 502, 503, 504)):
        if max_retries < 0:
            raise ValueError("max_retries must be >= 0")
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self.retry_on = retry_on

    def delay_for(self, attempt: int) -> float:
        """Exponential backoff delay in seconds."""
        return self.backoff_factor * (2 ** attempt)


class APIClient:
    """Simple JSON API client."""

    def __init__(
        self,
        base_url: str,
        headers: Optional[dict] = None,
        retry_policy: Optional[RetryPolicy] = None,
        timeout: int = 30,
    ):
        self.base_url = base_url.rstrip("/")
        self.headers = headers or {}
        self.retry_policy = retry_policy or RetryPolicy()
        self.timeout = timeout

    def get(self, path: str, params: Optional[dict] = None) -> Any:
        url = self._build_url(path, params)
        return self._request("GET", url)

    def post(self, path: str, body: Any) -> Any:
        url = self._build_url(path)
        return self._request("POST", url, body)

    def put(self, path: str, body: Any) -> Any:
        url = self._build_url(path)
        return self._request("PUT", url, body)

    def delete(self, path: str) -> Any:
        url = self._build_url(path)
        return self._request("DELETE", url)

    def _build_url(self, path: str, params: Optional[dict] = None) -> str:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        return url

    def _request(self, method: str, url: str, body: Any = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        headers.update(self.headers)
        policy = self.retry_policy
        last_error = None
        for attempt in range(policy.max_retries + 1):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    if raw:
                        return json.loads(raw)
                    return None
            except urllib.error.HTTPError as e:
                if e.code in policy.retry_on and attempt < policy.max_retries:
                    time.sleep(policy.delay_for(attempt))
                    last_error = e
                    continue
                body = None
                try:
                    body = json.loads(e.read())
                except Exception:
                    pass
                raise APIError(e.code, str(e.reason), body) from e
            except urllib.error.URLError as e:
                if attempt < policy.max_retries:
                    time.sleep(policy.delay_for(attempt))
                    last_error = e
                    continue
                raise
        raise last_error  # type: ignore[misc]
