/**
 * Compares final raster pixels, ignoring encoded metadata and compression.
 * State lasts for this executor only: a restart conservatively sends again.
 *
 * @module lib/scheduler/unchanged-upload
 */
import { createHash } from 'node:crypto'
import gmLib from 'gm'

const gm = gmLib.subClass({ imageMagick: true })

/** ImageMagick's signature hashes pixels; dimensions disambiguate their layout. */
export async function pixelSignature(image: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // gm's identify getter uses -ping, which does not decode pixel data.
    gm(image).out('-format', '%w:%h:%#').toBuffer('INFO', (err, buffer) => {
      if (err) return reject(err)
      const value = buffer.toString().trim()
      if (!/^\d+:\d+:[a-f0-9]{64}$/i.test(value)) {
        return reject(new Error('Invalid image signature'))
      }
      resolve(value)
    })
  })
}

/** Hashes comparison context without retaining credential-bearing URLs/headers. */
export function contextDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Serializes deliveries sharing a URL, including manual and non-opted-in sends. */
export class UnchangedUploads {
  #delivered = new Map<string, string>()
  #pending = new Map<string, Promise<unknown>>()

  /** Runs a delivery decision exclusively for this destination. */
  async run<T>(destination: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#pending.get(destination) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    this.#pending.set(destination, current)
    try {
      return await current
    } finally {
      if (this.#pending.get(destination) === current) this.#pending.delete(destination)
    }
  }

  /** Only an acknowledged successful upload establishes a comparison baseline. */
  matches(destination: string, signature: string): boolean {
    return this.#delivered.get(destination) === signature
  }

  /** Invalidate before a send: even a failed response may have changed the server. */
  forget(destination: string): void {
    this.#delivered.delete(destination)
  }

  /** Remember a successful delivery, without keeping image bytes or credentials. */
  remember(destination: string, signature: string): void {
    this.#delivered.set(destination, signature)
  }
}
