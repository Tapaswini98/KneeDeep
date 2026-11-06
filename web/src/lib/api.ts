/** Same-origin in dev (Vite proxies /v1 and /health to the API). Set VITE_API_URL when hosted separately. */
const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message =
      (body as { message?: string | string[] } | undefined)?.message ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message);
  }
  return body as T;
}

export interface Health {
  ok: boolean;
  postgres: { ok: boolean };
  arkiv: { ok: boolean; detail?: string };
  hedera: { ok: boolean; detail?: string };
}
