/**
 * Test script to reproduce slow-loading widget issue
 *
 * This script tests the screenshot capture with widgets that load async content
 * to demonstrate the empty screenshot / loading spinner problem
 */

import { Browser } from './screenshot.js'
import { writeFileSync } from 'fs'

const MOCK_HA_URL = 'http://localhost:8123'
const MOCK_TOKEN = 'mock-token'

async function testSlowLoading() {
  console.log('='.repeat(60))
  console.log('Testing Slow-Loading Widgets')
  console.log('='.repeat(60))

  const browser = new Browser(MOCK_HA_URL, MOCK_TOKEN)

  try {
    // Test 1: Navigate with default wait (smart wait, max 3s)
    console.log('\n--- Test 1: Default Smart Wait (max 3s) ---')
    const startTime1 = Date.now()

    await browser.navigatePage({
      pagePath: '/lovelace/slow',
      viewport: { width: 800, height: 480 },
    })

    const navTime1 = Date.now() - startTime1
    console.log(`Navigation completed in ${navTime1}ms`)

    const screenshot1 = await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      format: 'png',
    })

    console.log(`Screenshot captured: ${screenshot1.image.length} bytes in ${screenshot1.time}ms`)
    writeFileSync('output-test1-default-wait.png', screenshot1.image)
    console.log('Saved: output-test1-default-wait.png')
    console.log('Expected result: Loading spinners visible (widgets not loaded yet)')

    await browser.cleanup()
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Test 2: Navigate with extraWait=10s (longer than widget load times)
    console.log('\n--- Test 2: Explicit Wait (10s) ---')
    const startTime2 = Date.now()

    await browser.navigatePage({
      pagePath: '/lovelace/slow',
      viewport: { width: 800, height: 480 },
      extraWait: 10000, // 10 seconds - should be enough for both widgets
    })

    const navTime2 = Date.now() - startTime2
    console.log(`Navigation completed in ${navTime2}ms`)

    const screenshot2 = await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      format: 'png',
    })

    console.log(`Screenshot captured: ${screenshot2.image.length} bytes in ${screenshot2.time}ms`)
    writeFileSync('output-test2-explicit-wait.png', screenshot2.image)
    console.log('Saved: output-test2-explicit-wait.png')
    console.log('Expected result: All widgets loaded (no spinners)')

    await browser.cleanup()
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Test 3: Navigate with shorter extraWait=6s (between weather and calendar load)
    console.log('\n--- Test 3: Medium Wait (6s) ---')
    const startTime3 = Date.now()

    await browser.navigatePage({
      pagePath: '/lovelace/slow',
      viewport: { width: 800, height: 480 },
      extraWait: 6000, // 6 seconds - weather loaded, calendar still loading
    })

    const navTime3 = Date.now() - startTime3
    console.log(`Navigation completed in ${navTime3}ms`)

    const screenshot3 = await browser.screenshotPage({
      viewport: { width: 800, height: 480 },
      format: 'png',
    })

    console.log(`Screenshot captured: ${screenshot3.image.length} bytes in ${screenshot3.time}ms`)
    writeFileSync('output-test3-medium-wait.png', screenshot3.image)
    console.log('Saved: output-test3-medium-wait.png')
    console.log('Expected result: Weather loaded, Calendar still loading')

    await browser.cleanup()

    console.log('\n' + '='.repeat(60))
    console.log('Test Results Summary:')
    console.log('='.repeat(60))
    console.log('Test 1: Should show loading spinners (too fast)')
    console.log('Test 2: Should show all content loaded')
    console.log('Test 3: Should show partial loading state')
    console.log('\nThis demonstrates the core issue: default wait is too short')
    console.log('for async-loading widgets like weather and calendar.')

  } catch (error) {
    console.error('Test failed:', error)
    await browser.cleanup()
    throw error
  }
}

// Run tests
testSlowLoading().catch(console.error)
