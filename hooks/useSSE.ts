'use client';

import { useEffect, useRef } from 'react';

export function useSSE(
  url: string,
  onMessage: (data: unknown) => void,
  enabled = true
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(url);
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current(data);
        } catch { /* ignore heartbeats */ }
      };
      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();
    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, [url, enabled]);
}
