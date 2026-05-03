import { FeedError } from "./errors";

export async function fetchArrayBuffer(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new FeedError(`MTA feed request failed: ${response.status} ${response.statusText}`, response);
  }
  return response.arrayBuffer();
}

export async function fetchJson(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new FeedError(`MTA API request failed: ${response.status} ${response.statusText}`, response);
  }
  return response.json() as Promise<unknown>;
}

export function urlWithParams(base: string, params: Record<string, string | number | undefined>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
