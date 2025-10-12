"""
Retry utilities with exponential backoff and jitter
"""
import asyncio
import random
import time
from typing import TypeVar, Callable, Any, Optional
from .config import BACKOFF_BASE_MS, BACKOFF_FACTOR, BACKOFF_JITTER_MAX_MS

T = TypeVar('T')


async def exponential_backoff_sleep(attempt: int, base_ms: int = BACKOFF_BASE_MS) -> None:
    """
    Sleep with exponential backoff and jitter.
    Formula: base_ms * (BACKOFF_FACTOR ^ attempt) + random_jitter
    """
    if attempt <= 0:
        return
    
    delay_ms = base_ms * (BACKOFF_FACTOR ** attempt)
    jitter_ms = random.uniform(0, BACKOFF_JITTER_MAX_MS)
    total_ms = delay_ms + jitter_ms
    
    await asyncio.sleep(total_ms / 1000.0)


async def retry_with_backoff(
    fn: Callable[..., Any],
    max_retries: int,
    timeout_ms: Optional[int] = None,
    fallback: Optional[T] = None
) -> T:
    """
    Retry a function with exponential backoff.
    Returns fallback if all retries exhausted.
    """
    last_error = None
    
    for attempt in range(max_retries + 1):
        try:
            if timeout_ms:
                return await asyncio.wait_for(
                    fn() if asyncio.iscoroutinefunction(fn) else asyncio.to_thread(fn),
                    timeout=timeout_ms / 1000.0
                )
            else:
                if asyncio.iscoroutinefunction(fn):
                    return await fn()
                else:
                    return fn()
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                await exponential_backoff_sleep(attempt)
            else:
                if fallback is not None:
                    return fallback
                raise last_error
    
    if fallback is not None:
        return fallback
    raise last_error


def generate_request_id() -> str:
    """Generate a short unique request ID."""
    import uuid
    return str(uuid.uuid4())[:8]

