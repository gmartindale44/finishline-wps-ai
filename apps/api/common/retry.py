"""
Retry utilities with exponential backoff and jitter.
"""
import asyncio
import random
import logging

log = logging.getLogger(__name__)


async def with_retries(
    coro_factory,
    *,
    attempts: int = 3,
    base_delay: float = 0.6,
    jitter: float = 0.3,
    timeout_per_attempt: float = None
):
    """
    Retry an async function with exponential backoff and jitter.
    
    Args:
        coro_factory: Callable that returns a coroutine
        attempts: Maximum number of attempts (default 3)
        base_delay: Base delay in seconds (default 0.6)
        jitter: Max random jitter in seconds (default 0.3)
        timeout_per_attempt: Optional timeout per attempt in seconds
    
    Returns:
        Result from successful attempt
    
    Raises:
        Last exception if all attempts fail
    
    Example:
        result = await with_retries(
            lambda: client.post(url, json=data),
            attempts=3
        )
    """
    last_err = None
    
    for attempt in range(attempts):
        try:
            coro = coro_factory()
            
            if timeout_per_attempt:
                result = await asyncio.wait_for(coro, timeout=timeout_per_attempt)
            else:
                result = await coro
            
            return result
        
        except Exception as e:
            last_err = e
            
            if attempt < attempts - 1:
                # Exponential backoff: base * (2 ^ attempt) + random jitter
                delay = base_delay * (2 ** attempt) + (random.random() * jitter)
                log.warning(f"Attempt {attempt + 1} failed, retrying in {delay:.2f}s: {str(e)[:100]}")
                await asyncio.sleep(delay)
            else:
                log.error(f"All {attempts} attempts failed: {str(e)[:100]}")
    
    raise last_err

