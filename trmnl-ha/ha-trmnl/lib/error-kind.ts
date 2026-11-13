/**
 * Names an error without its message, which can echo credentials.
 *
 * @module lib/error-kind
 */

/** The error's code (ECONNREFUSED, ENOTFOUND), its cause's code, or its type name. */
export function errorKind(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error'

  const code = (err as { code?: unknown }).code ?? (err.cause as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : err.name
}
