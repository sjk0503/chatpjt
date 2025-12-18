import { API_BASE_URL } from '../config';

export type ApiEnvelope<T> = {
  success: boolean;
  message?: string;
  data?: T;
};

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type ApiCallOptions = {
  auth?: boolean;
};

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  apiOptions: ApiCallOptions = {}
): Promise<ApiEnvelope<T>> {
  const auth = apiOptions.auth ?? true;
  const token = localStorage.getItem('token');
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {};
  if (options.headers) {
    Object.assign(headers, options.headers as Record<string, string>);
  }
  if (!headers['Content-Type'] && options.body) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });

  let payload: ApiEnvelope<T>;
  try {
    payload = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError('서버 응답을 해석할 수 없습니다.', res.status);
  }

  if (res.status === 401) {
    localStorage.removeItem('token');
  }

  if (!payload.success) {
    throw new ApiError(payload.message || 'API 요청 실패', res.status);
  }

  return payload;
}

