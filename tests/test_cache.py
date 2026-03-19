"""Tests for cache module — very thin coverage."""
import pytest
from src.cache import LRUCache


class TestLRUCache:
    def test_set_and_get(self):
        cache = LRUCache(max_size=10)
        cache.set("key", "value")
        assert cache.get("key") == "value"

    def test_get_missing_key_returns_none(self):
        cache = LRUCache(max_size=10)
        assert cache.get("missing") is None

    def test_size(self):
        cache = LRUCache(max_size=10)
        cache.set("a", 1)
        cache.set("b", 2)
        assert cache.size() == 2

    # MISSING: test_lru_eviction_when_max_size_reached  ← core LRU behaviour untested
    # MISSING: test_ttl_expiry_returns_none
    # MISSING: test_default_ttl_applied_to_entries
    # MISSING: test_delete_existing_key
    # MISSING: test_delete_nonexistent_key_returns_false
    # MISSING: test_clear_empties_cache
    # MISSING: test_update_existing_key_moves_to_mru_position
    # MISSING: test_invalid_max_size_raises
    # MISSING: test_thread_safety_concurrent_writes  ← cache is thread-safe by design

# ENTIRELY MISSING:
# - No tests for CacheEntry directly (is_expired logic)
# - No tests for the cache with None values stored
