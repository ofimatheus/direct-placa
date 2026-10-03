/**
 * Executa fn com um AbortSignal que dispara após ms. Usa setTimeout comum
 * (mantém o processo vivo até o fim) e sempre limpa o timer — diferente de
 * AbortSignal.timeout(), cujo timer não segura o event loop.
 */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`tempo esgotado (${ms} ms)`)), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
