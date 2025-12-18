import { useEffect, useRef } from 'react';
import { buildWsUrl } from '../config';

type UseWebSocketOptions = {
  enabled?: boolean;
  onOpen?: (ws: WebSocket) => void;
  reconnectMs?: number;
};

export function useWebSocket(
  onMessage: (data: any) => void,
  options: UseWebSocketOptions = {}
) {
  const { enabled = true, onOpen, reconnectMs = 3000 } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (!enabled) return;

    const connect = () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      const ws = new WebSocket(buildWsUrl(token));
      wsRef.current = ws;

      ws.onopen = () => onOpenRef.current?.(ws);
      ws.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data));
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!enabled) return;
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(connect, reconnectMs);
      };
    };

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled, reconnectMs]);

  const sendJson = (payload: any) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  };

  return { wsRef, sendJson };
}
