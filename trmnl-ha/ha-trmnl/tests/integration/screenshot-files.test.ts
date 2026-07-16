/**
 * Integration tests for Screenshot File Operations
 *
 * Tests saveScreenshot and cleanupOldScreenshots with real file I/O.
 *
 * @module tests/integration/screenshot-files
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveScreenshot } from '../../lib/scheduler/screenshot-saver.js'
import { cleanupOldScreenshots } from '../../lib/scheduler/screenshot-cleanup.js'
import { createPNGBuffer } from '../helpers/image-helper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_OUTPUT_DIR = path.join(__dirname, '../test-screenshot-files')

/** Creates file with specific mtime for testing cleanup */
function createFileWithAge(name: string, ageMs: number): void {
  const filePath = path.join(TEST_OUTPUT_DIR, name)
  fs.writeFileSync(filePath, createPNGBuffer())
  const mtime = new Date(Date.now() - ageMs)
  fs.utimesSync(filePath, mtime, mtime)
}

describe('Screenshot File Operations', () => {
  beforeEach(() => {
    // Create fresh test directory
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true })
    }
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true })
  })

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true })
    }
  })

  // ==========================================================================
  // saveScreenshot() - File creation and naming
  // ==========================================================================

  describe('saveScreenshot', () => {
    it('creates file in output directory', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test Schedule',
        imageBuffer: createPNGBuffer(),
        format: 'png',
      })

      expect(fs.existsSync(result.outputPath)).toBe(true)
    })

    it('uses correct file extension for png', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test',
        imageBuffer: createPNGBuffer(),
        format: 'png',
      })

      expect(result.filename).toMatch(/\.png$/)
    })

    it('uses correct file extension for jpeg', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test',
        imageBuffer: createPNGBuffer(),
        format: 'jpeg',
      })

      expect(result.filename).toMatch(/\.jpeg$/)
    })

    it('uses correct file extension for bmp', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test',
        imageBuffer: createPNGBuffer(),
        format: 'bmp',
      })

      expect(result.filename).toMatch(/\.bmp$/)
    })

    it('sanitizes schedule name for filename', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'My Test/Schedule!',
        imageBuffer: createPNGBuffer(),
        format: 'png',
      })

      expect(result.filename).not.toContain('/')
      expect(result.filename).not.toContain('!')
      expect(result.filename).toContain('My_Test_Schedule_')
    })

    it('includes timestamp in filename', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test',
        imageBuffer: createPNGBuffer(),
        format: 'png',
      })

      // Timestamp format: YYYY-MM-DDTHH-MM-SS
      expect(result.filename).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)
    })

    it('writes correct buffer content', () => {
      const buffer = createPNGBuffer()

      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test',
        imageBuffer: buffer,
        format: 'png',
      })

      const written = fs.readFileSync(result.outputPath)
      expect(Buffer.compare(written, buffer)).toBe(0)
    })

    it('returns outputPath and filename', () => {
      const result = saveScreenshot({
        outputDir: TEST_OUTPUT_DIR,
        scheduleName: 'Test',
        imageBuffer: createPNGBuffer(),
        format: 'png',
      })

      expect(result).toHaveProperty('outputPath')
      expect(result).toHaveProperty('filename')
      expect(result.outputPath).toContain(result.filename)
    })
  })

  // ==========================================================================
  // cleanupOldScreenshots() - LRU deletion
  // ==========================================================================

  describe('cleanupOldScreenshots', () => {
    it('deletes oldest files when over maxFiles limit', () => {
      // Create 5 files with different ages
      createFileWithAge('old1.png', 50000)
      createFileWithAge('old2.png', 40000)
      createFileWithAge('new1.png', 10000)
      createFileWithAge('new2.png', 5000)
      createFileWithAge('new3.png', 1000)

      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 3,
      })

      expect(result.totalFiles).toBe(5)
      expect(result.deletedCount).toBe(2)
      expect(result.deletedFiles).toContain('old1.png')
      expect(result.deletedFiles).toContain('old2.png')
    })

    it('keeps all files when under maxFiles limit', () => {
      createFileWithAge('file1.png', 1000)
      createFileWithAge('file2.png', 2000)

      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 5,
      })

      expect(result.totalFiles).toBe(2)
      expect(result.deletedCount).toBe(0)
      expect(result.deletedFiles).toEqual([])
    })

    it('handles empty directory', () => {
      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 5,
      })

      expect(result.totalFiles).toBe(0)
      expect(result.deletedCount).toBe(0)
    })

    it('only matches image files by default', () => {
      createFileWithAge('image.png', 5000)
      createFileWithAge('image.jpeg', 4000)
      createFileWithAge('image.bmp', 3000)
      fs.writeFileSync(path.join(TEST_OUTPUT_DIR, 'config.json'), '{}')
      fs.writeFileSync(path.join(TEST_OUTPUT_DIR, 'readme.txt'), 'text')

      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 10,
      })

      expect(result.totalFiles).toBe(3) // Only image files counted
    })

    it('uses custom file pattern when provided', () => {
      createFileWithAge('file.png', 2000)
      createFileWithAge('file.txt', 1000)

      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 0,
        filePattern: /\.txt$/,
      })

      expect(result.totalFiles).toBe(1)
      expect(result.deletedCount).toBe(1)
      expect(result.deletedFiles).toContain('file.txt')
    })

    it('returns error when directory does not exist', () => {
      const result = cleanupOldScreenshots({
        outputDir: '/nonexistent/path',
        maxFiles: 5,
      })

      expect(result.error).toBeDefined()
      expect(result.totalFiles).toBe(0)
    })

    it('deletes files in order oldest-first', () => {
      createFileWithAge('oldest.png', 100000)
      createFileWithAge('middle.png', 50000)
      createFileWithAge('newest.png', 1000)

      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 1,
      })

      expect(result.deletedCount).toBe(2)
      expect(result.deletedFiles[0]).toBe('oldest.png')
      expect(result.deletedFiles[1]).toBe('middle.png')
    })
  })

  // ==========================================================================
  // Integration - Save and Cleanup Together
  // ==========================================================================

  describe('Save and Cleanup Integration', () => {
    it('cleanup works on files created by saveScreenshot', () => {
      // Create 5 screenshots
      for (let i = 0; i < 5; i++) {
        saveScreenshot({
          outputDir: TEST_OUTPUT_DIR,
          scheduleName: `Schedule ${i}`,
          imageBuffer: createPNGBuffer(),
          format: 'png',
        })
      }

      const result = cleanupOldScreenshots({
        outputDir: TEST_OUTPUT_DIR,
        maxFiles: 3,
      })

      expect(result.totalFiles).toBe(5)
      expect(result.deletedCount).toBe(2)

      const remaining = fs.readdirSync(TEST_OUTPUT_DIR)
      expect(remaining).toHaveLength(3)
    })
  })
})
