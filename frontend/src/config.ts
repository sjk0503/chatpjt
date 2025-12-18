export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function defaultWsBaseUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}`;
}

export const WS_BASE_URL = import.meta.env.VITE_WS_URL || defaultWsBaseUrl();

export function buildWsUrl(token: string): string {
  const base = WS_BASE_URL.replace(/\/$/, '');
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

