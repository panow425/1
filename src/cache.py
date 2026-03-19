"""Simple in-memory caching with TTL support."""
import time
from threading import Lock
from typing import Any, Optional


class CacheEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, ttl: Optional[float]):
        self.value = value
        self.expires_at = time.monotonic() + ttl if ttl is not None else None

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return time.monotonic() > self.expires_at


class LRUCache:
    """Thread-safe LRU cache with optional per-entry TTL."""

    def __init__(self, max_size: int = 128, default_ttl: Optional[float] = None):
        if max_size <= 0:
            raise ValueError("max_size must be > 0")
        self.max_size = max_size
        self.default_ttl = default_ttl
        self._store: dict[str, CacheEntry] = {}
        self._order: list[str] = []
        self._lock = Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if entry.is_expired():
                self._evict(key)
                return None
            self._order.remove(key)
            self._order.append(key)
            return entry.value

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        with self._lock:
            effective_ttl = ttl if ttl is not None else self.default_ttl
            if key in self._store:
                self._order.remove(key)
            elif len(self._store) >= self.max_size:
                lru_key = self._order.pop(0)
                del self._store[lru_key]
            self._store[key] = CacheEntry(value, effective_ttl)
            self._order.append(key)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key not in self._store:
                return False
            self._evict(key)
            return True

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._order.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def _evict(self, key: str) -> None:
        del self._store[key]
        if key in self._order:
            self._order.remove(key)
