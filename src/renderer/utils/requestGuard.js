/**
 * Small helpers for request-version guards.
 * Use with useRef(0) counters to prevent stale async responses
 * from applying state updates after newer requests have started.
 */

export function nextRequestId(counterRef) {
  counterRef.current += 1;
  return counterRef.current;
}

export function isCurrentRequest(counterRef, requestId) {
  return counterRef.current === requestId;
}

export function invalidateRequests(counterRef) {
  counterRef.current += 1;
  return counterRef.current;
}
