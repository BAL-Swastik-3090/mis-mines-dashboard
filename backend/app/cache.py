import json
import redis
from functools import wraps
from typing import Any, Callable
from app.config import get_settings

settings = get_settings()

_redis_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            password=settings.redis_password or None,
            decode_responses=True,
        )
    return _redis_client


def cache_response(ttl: int = 300, key_prefix: str = ""):
    """
    Decorator to cache FastAPI endpoint responses in Redis.
    ttl: seconds to cache (default 5 min)
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            r = get_redis()
            cache_key = f"mines:{key_prefix}:{func.__name__}:{str(kwargs)}"
            try:
                cached = r.get(cache_key)
                if cached:
                    return json.loads(cached)
            except Exception:
                pass  # Redis down — fall through to DB

            result = await func(*args, **kwargs)

            try:
                r.setex(cache_key, ttl, json.dumps(result, default=str))
            except Exception:
                pass

            return result
        return wrapper
    return decorator


def invalidate_cache(pattern: str = "mines:*"):
    """Clear cache entries matching pattern."""
    r = get_redis()
    keys = r.keys(pattern)
    if keys:
        r.delete(*keys)
