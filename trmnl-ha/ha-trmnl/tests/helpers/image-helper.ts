/**
 * Image Helper Utilities
 *
 * Generates minimal valid image buffers for testing without ImageMagick,
 * plus ImageMagick-based colorful test images for integration tests.
 *
 * @module tests/helpers/image-helper
 */

import gmLib from 'gm'

const gm = gmLib.subClass({ imageMagick: true })

/** Supported image format types */
type ImageFormat = 'png' | 'jpeg' | 'bmp' | 'unknown'

// =============================================================================
// IMAGEMAGICK-BASED TEST IMAGES (for integration tests)
// =============================================================================

/**
 * Creates a colorful test image with 4 distinct color quadrants
 * Tests that palette remapping constrains diverse colors
 */
export async function createColorfulTestImage(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    gm(100, 100, '#FFFFFF')
      .fill('#FF0000')
      .drawRectangle(0, 0, 49, 49)
      .fill('#00FF00')
      .drawRectangle(50, 0, 99, 49)
      .fill('#0000FF')
      .drawRectangle(0, 50, 49, 99)
      .fill('#FFFF00')
      .drawRectangle(50, 50, 99, 99)
      .stream('png', (err, stdout, stderr) => {
        if (err) {
          reject(err)
          return
        }
        stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
        stdout.on('end', () => resolve(Buffer.concat(chunks)))
        stdout.on('error', reject)
        stderr.on('data', () => {})
      })
  })
}

/**
 * Creates a gradient-like test image with multiple color bands
 */
export async function createGradientTestImage(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    gm(200, 100, '#FF0000')
      .fill('#CC0033')
      .drawRectangle(40, 0, 79, 99)
      .fill('#990066')
      .drawRectangle(80, 0, 119, 99)
      .fill('#660099')
      .drawRectangle(120, 0, 159, 99)
      .fill('#3300CC')
      .drawRectangle(160, 0, 199, 99)
      .stream('png', (err, stdout, stderr) => {
        if (err) {
          reject(err)
          return
        }
        stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
        stdout.on('end', () => resolve(Buffer.concat(chunks)))
        stdout.on('error', reject)
        stderr.on('data', () => {})
      })
  })
}

/**
 * Creates a solid color test image
 * @param color - Hex color (e.g., '#FFA500')
 * @param size - Image dimensions (default: 50x50)
 */
export async function createSolidColorImage(
  color: string,
  size: number = 50
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []

    gm(size, size, color).stream('png', (err, stdout, stderr) => {
      if (err) {
        reject(err)
        return
      }
      stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      stdout.on('end', () => resolve(Buffer.concat(chunks)))
      stdout.on('error', reject)
      stderr.on('data', () => {})
    })
  })
}

// =============================================================================
// MINIMAL BUFFERS (for unit tests without ImageMagick)
// =============================================================================

/**
 * Creates a minimal valid PNG buffer
 * Uses PNG file format specification with smallest possible image (1x1 pixel)
 */
export function createPNGBuffer(
  _width: number = 1,
  _height: number = 1
): Buffer {
  // Minimal 1x1 black PNG (67 bytes)
  // PNG signature + IHDR + IDAT + IEND chunks
  const pngData = Buffer.from([
    // PNG signature
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    // IHDR chunk (13 bytes data + 12 bytes overhead)
    0x00,
    0x00,
    0x00,
    0x0d, // Length: 13
    0x49,
    0x48,
    0x44,
    0x52, // 'IHDR'
    0x00,
    0x00,
    0x00,
    0x01, // Width: 1
    0x00,
    0x00,
    0x00,
    0x01, // Height: 1
    0x08, // Bit depth: 8
    0x00, // Color type: Grayscale
    0x00, // Compression: deflate
    0x00, // Filter: adaptive
    0x00, // Interlace: none
    0x90,
    0x77,
    0x53,
    0xde, // CRC
    // IDAT chunk (compressed image data)
    0x00,
    0x00,
    0x00,
    0x0c, // Length: 12
    0x49,
    0x44,
    0x41,
    0x54, // 'IDAT'
    0x08,
    0xd7,
    0x63,
    0x60,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x01, // Compressed data
    0xe2,
    0x21,
    0xbc,
    0x33, // CRC
    // IEND chunk
    0x00,
    0x00,
    0x00,
    0x00, // Length: 0
    0x49,
    0x45,
    0x4e,
    0x44, // 'IEND'
    0xae,
    0x42,
    0x60,
    0x82, // CRC
  ])

  return pngData
}

/**
 * Creates a minimal valid JPEG buffer
 * Uses JPEG/JFIF format specification
 */
export function createJPEGBuffer(): Buffer {
  // Minimal 1x1 black JPEG (134 bytes)
  const jpegData = Buffer.from([
    // SOI (Start of Image)
    0xff, 0xd8,
    // APP0 (JFIF marker)
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // DQT (Define Quantization Table)
    0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
    0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b,
    0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d,
    0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c,
    0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
    0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32,
    // SOF0 (Start of Frame)
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00,
    // DHT (Define Huffman Table)
    0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // SOS (Start of Scan)
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf,
    0x20,
    // EOI (End of Image)
    0xff, 0xd9,
  ])

  return jpegData
}

/**
 * Creates a minimal valid BMP buffer
 * Uses BMP file format specification
 */
export function createBMPBuffer(): Buffer {
  // Minimal 1x1 black BMP (58 bytes)
  const bmpData = Buffer.from([
    // BMP Header
    0x42,
    0x4d, // 'BM' signature
    0x3a,
    0x00,
    0x00,
    0x00, // File size: 58 bytes
    0x00,
    0x00, // Reserved
    0x00,
    0x00, // Reserved
    0x36,
    0x00,
    0x00,
    0x00, // Offset to pixel data: 54 bytes
    // DIB Header (BITMAPINFOHEADER)
    0x28,
    0x00,
    0x00,
    0x00, // Header size: 40 bytes
    0x01,
    0x00,
    0x00,
    0x00, // Width: 1
    0x01,
    0x00,
    0x00,
    0x00, // Height: 1
    0x01,
    0x00, // Color planes: 1
    0x18,
    0x00, // Bits per pixel: 24
    0x00,
    0x00,
    0x00,
    0x00, // Compression: none
    0x04,
    0x00,
    0x00,
    0x00, // Image size: 4 bytes (including padding)
    0x00,
    0x00,
    0x00,
    0x00, // X pixels per meter
    0x00,
    0x00,
    0x00,
    0x00, // Y pixels per meter
    0x00,
    0x00,
    0x00,
    0x00, // Colors in palette
    0x00,
    0x00,
    0x00,
    0x00, // Important colors
    // Pixel data (1 pixel, black, with 1 byte padding)
    0x00,
    0x00,
    0x00,
    0x00, // BGR + padding
  ])

  return bmpData
}

/**
 * Validates image buffer magic number matches expected format
 */
export function validateImageMagic(buffer: Buffer, format: string): boolean {
  if (!buffer || buffer.length < 4) {
    return false
  }

  switch (format.toLowerCase()) {
    case 'png':
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
      )

    case 'jpeg':
    case 'jpg':
      return buffer[0] === 0xff && buffer[1] === 0xd8

    case 'bmp':
      return (
        buffer[0] === 0x42 && // 'B'
        buffer[1] === 0x4d
      ) // 'M'

    default:
      return false
  }
}

/**
 * Detects the format of an image buffer by checking magic numbers
 */
export function getImageFormat(buffer: Buffer): ImageFormat {
  if (validateImageMagic(buffer, 'png')) return 'png'
  if (validateImageMagic(buffer, 'jpeg')) return 'jpeg'
  if (validateImageMagic(buffer, 'bmp')) return 'bmp'
  return 'unknown'
}

/**
 * Asserts that a buffer is a valid image of the expected format
 */
export function assertValidImage(
  buffer: Buffer,
  expectedFormat: ImageFormat
): void {
  const actualFormat = getImageFormat(buffer)

  if (actualFormat === 'unknown') {
    throw new Error('Buffer is not a valid image (unknown format)')
  }

  if (actualFormat !== expectedFormat) {
    throw new Error(`Expected ${expectedFormat} image but got ${actualFormat}`)
  }
}
