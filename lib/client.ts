'use client';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const list = <T,>(resource: string) => api<T[]>(`/api/${resource}`);
export const create = <T,>(resource: string, body: unknown) =>
  api<T>(`/api/${resource}`, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T,>(resource: string, id: string, body: unknown) =>
  api<T>(`/api/${resource}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const remove = (resource: string, id: string) =>
  api<{ ok: boolean }>(`/api/${resource}/${id}`, { method: 'DELETE' });
