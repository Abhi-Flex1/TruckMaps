import { useEffect, useRef, useState } from "react";
import { autocompletePlaces } from "../services/routing";

export function useDebouncedPlaces(query, options = {}) {
  const {
    minLength = 2,
    delayMs = 220,
    skip = false
  } = options;

  const [suggestions, setSuggestions] = useState([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (skip || !trimmed || trimmed.length < minLength) {
      setSuggestions([]);
      return;
    }

    const requestId = Date.now();
    requestIdRef.current = requestId;

    const timeoutId = setTimeout(async () => {
      try {
        const items = await autocompletePlaces(trimmed, 5);
        if (requestIdRef.current !== requestId) return;
        setSuggestions(items);
      } catch {
        if (requestIdRef.current !== requestId) return;
        setSuggestions([]);
      }
    }, delayMs);

    return () => clearTimeout(timeoutId);
  }, [delayMs, minLength, query, skip]);

  return [suggestions, setSuggestions];
}
