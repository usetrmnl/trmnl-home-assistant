/**
 * Transpiles a TypeScript source string to JavaScript for on-the-fly
 * frontend serving.
 *
 * Uses Bun's built-in transpiler when running under Bun, and esbuild
 * (bundled with tsx) when running under Node. The Node path is only
 * reached on CPUs too old for Bun's baseline build; see docker-entrypoint.sh.
 *
 * @module lib/transpile-ts
 */

/** Bun's transpiler is present only under the Bun runtime. */
declare const Bun:
  | { Transpiler: new (opts: { loader: string }) => { transformSync(src: string): string } }
  | undefined

/** Transpiles TypeScript source to JavaScript. */
export async function transpileTypeScript(source: string): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  }
  const { transformSync } = await import('esbuild')
  return transformSync(source, { loader: 'ts', format: 'esm' }).code
}
