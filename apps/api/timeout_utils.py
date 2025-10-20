"""
Timeout utilities for safe provider calls within Vercel function limits.
Prevents FUNCTION_INVOCATION_FAILED by enforcing strict timeouts.
"""
import asyncio
import logging
from typing import Callable, TypeVar, Any
from functools import wraps

logger = logging.getLogger(__name__)

T = TypeVar('T')


async def with_timeout(
    coro_func: Callable[..., Any],
    timeout_seconds: float,
    fallback: Any = None,
    operation_name: str = "operation"
) -> Any:
    """
    Execute an async operation with a strict timeout.
    
    Args:
        coro_func: Async function to execute
        timeout_seconds: Maximum execution time in seconds
        fallback: Value to return on timeout (if None, raises TimeoutError)
        operation_name: Name for logging
    
    Returns:
        Result from coro_func or fallback value
        
    Raises:
        asyncio.TimeoutError: If timeout reached and no fallback provided
    """
    try:
        result = await asyncio.wait_for(coro_func(), timeout=timeout_seconds)
        return result
    except asyncio.TimeoutError:
        logger.warning(f"[timeout] {operation_name} exceeded {timeout_seconds}s")
        if fallback is not None:
            return fallback
        raise


def timeout_decorator(seconds: float):
    """
    Decorator to add timeout to async functions.
    
    Usage:
        @timeout_decorator(10.0)
        async def my_function():
            ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await asyncio.wait_for(func(*args, **kwargs), timeout=seconds)
            except asyncio.TimeoutError:
                logger.error(f"[timeout] {func.__name__} exceeded {seconds}s")
                raise
        return wrapper
    return decorator


class TimeboxedProvider:
    """
    Wrapper for provider calls with per-operation timeouts.
    Ensures no single operation exceeds Vercel function limits.
    """
    
    def __init__(self, max_duration_seconds: float = 55.0):
        self.max_duration = max_duration_seconds
        self.start_time = None
    
    def __enter__(self):
        import time
        self.start_time = time.perf_counter()
        return self
    
    def __exit__(self, *args):
        pass
    
    def remaining_seconds(self) -> float:
        """Calculate remaining time in budget."""
        import time
        if self.start_time is None:
            return self.max_duration
        elapsed = time.perf_counter() - self.start_time
        return max(1.0, self.max_duration - elapsed)  # Always leave 1s minimum


async def batch_with_timeout(
    items: list,
    async_processor: Callable,
    batch_size: int = 4,
    timeout_per_batch: float = 25.0
) -> list:
    """
    Process items in batches with per-batch timeout.
    Useful for large horse lists that might timeout as a single operation.
    
    Args:
        items: List of items to process
        async_processor: Async function that takes a batch and returns results
        batch_size: Items per batch
        timeout_per_batch: Max seconds per batch
    
    Returns:
        Concatenated results from all batches
    """
    results = []
    
    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        batch_num = i // batch_size + 1
        
        try:
            batch_result = await asyncio.wait_for(
                async_processor(batch),
                timeout=timeout_per_batch
            )
            results.extend(batch_result if isinstance(batch_result, list) else [batch_result])
        except asyncio.TimeoutError:
            logger.warning(f"[batch] Batch {batch_num} timed out, using fallback")
            # Use original items as fallback (no enrichment)
            results.extend(batch)
        except Exception as e:
            logger.error(f"[batch] Batch {batch_num} failed: {e}")
            results.extend(batch)
    
    return results

