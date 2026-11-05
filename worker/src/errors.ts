export class AppError extends Error {
  status: number;
  code: string;
  diagnostics?: Record<string, unknown>;

  constructor(status: number, code: string, message?: string, diagnostics?: Record<string, unknown>) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return jsonResponse(err.status, { error: { code: err.code, message: err.message } });
  }
  return jsonResponse(500, { error: { code: "INTERNAL", message: "Internal server error" } });
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
