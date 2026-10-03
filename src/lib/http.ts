import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

const SQLSTATE_TO_HTTP: Record<string, number> = {
  "42501": 403, // insufficient_privilege (inclui violação de RLS)
  "22023": 400, // invalid_parameter_value
  P0002: 404, // no_data_found
  "55000": 409, // object_not_in_prerequisite_state
  "23505": 409, // unique_violation
  "23514": 422, // check_violation
  "23503": 409, // foreign_key_violation
};

interface DbErrorLike {
  code?: string;
  message: string;
  details?: string | null;
}

export function httpErrorFromDb(error: DbErrorLike, fallbackMessage = "Erro ao acessar o banco de dados."): HttpError {
  const status = (error.code && SQLSTATE_TO_HTTP[error.code]) || 500;
  const message = status === 500 ? fallbackMessage : error.message;
  return new HttpError(status, message, status === 500 ? undefined : error.details ?? undefined);
}

/** Converte qualquer erro em resposta JSON consistente. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Dados inválidos.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 400 },
    );
  }
  console.error(error);
  return NextResponse.json({ error: "Erro inesperado no servidor." }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Corpo da requisição não é um JSON válido.");
  }
}
