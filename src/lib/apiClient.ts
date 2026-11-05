import { auth } from "./firebase";

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error(
    'Missing VITE_API_BASE_URL. Copy .env.example to .env.local and set it to your Worker URL (e.g. "http://127.0.0.1:8787" for local development).'
  );
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface ApiResult<T> {
  data: T;
}

export async function callApi<T>(operation: string, input: unknown): Promise<ApiResult<T>> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError("AUTH_REQUIRED", "AUTH_REQUIRED", 401);
  }
  const idToken = await user.getIdToken();

  const res = await fetch(`${API_BASE_URL}/api/${operation}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: input }),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const errorBody = body as { error?: { code?: string; message?: string } } | null;
    const code = errorBody?.error?.code ?? "INTERNAL";
    const message = errorBody?.error?.message ?? code;
    throw new ApiError(code, message, res.status);
  }

  const resultBody = body as { result?: T } | null;
  return { data: resultBody?.result as T };
}
