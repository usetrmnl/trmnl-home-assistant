#!/usr/bin/env bun

/**
 * Release script to bump version across project files
 * Usage: bun scripts/release.js [patch|minor|major]
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = join(__dirname, '..')
const GITHUB_REPO = 'usetrmnl/trmnl-home-assistant'

// The repo ships two add-ons off one tag stream, so which one is being released
// has to be stated rather than assumed.
const ADDONS = {
  'trmnl-ha': {
    dir: 'trmnl-ha',
    packageJson: 'trmnl-ha/ha-trmnl/package.json',
    tagPrefix: 'v',
    bumpable: true,
  },
  'trmnl-terminus': {
    dir: 'trmnl-terminus',
    packageJson: null,
    tagPrefix: 'terminus-v',
    // Its version mirrors the bundled Terminus release, so it is never bumped
    // here - the upstream bump workflow sets it and this only publishes it.
    bumpable: false,
  },
}

let ADDON
let PATHS
let TAG_PREFIX

function selectAddon(slug) {
  ADDON = ADDONS[slug]
  TAG_PREFIX = ADDON.tagPrefix
  PATHS = {
    packageJson: ADDON.packageJson ? join(ROOT_DIR, ADDON.packageJson) : null,
    configYaml: join(ROOT_DIR, ADDON.dir, 'config.yaml'),
    changelog: join(ROOT_DIR, ADDON.dir, 'CHANGELOG.md'),
  }
}

/**
 * Bump a semantic version string
 */
function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number)

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      throw new Error(`Invalid bump type: ${type}. Use patch, minor, or major`)
  }
}

/**
 * Get current version from package.json, or config.yaml for add-ons without one
 */
function getCurrentVersion() {
  if (PATHS.packageJson) {
    return JSON.parse(readFileSync(PATHS.packageJson, 'utf8')).version
  }
  const match = readFileSync(PATHS.configYaml, 'utf8').match(
    /^version: "(.*)"$/m
  )
  if (!match) throw new Error(`No version found in ${PATHS.configYaml}`)
  return match[1]
}

/**
 * Update package.json version
 */
function updatePackageJson(newVersion) {
  if (!PATHS.packageJson) return
  const pkg = JSON.parse(readFileSync(PATHS.packageJson, 'utf8'))
  pkg.version = newVersion
  writeFileSync(PATHS.packageJson, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✅ Updated package.json to ${newVersion}`)
}

/**
 * Update config.yaml version
 */
function updateConfigYaml(newVersion) {
  let content = readFileSync(PATHS.configYaml, 'utf8')
  content = content.replace(/^version: ".*"$/m, `version: "${newVersion}"`)
  writeFileSync(PATHS.configYaml, content)
  console.log(`✅ Updated config.yaml to ${newVersion}`)
}

/**
 * Get commits since last tag, categorized by type
 */
function getCommitsSinceLastTag() {
  let lastTag
  try {
    // Scoped to this add-on's prefix: the other add-on's tags interleave in this
    // repo, and an unfiltered lookup builds the changelog from the wrong range.
    lastTag = execSync(
      `git tag -l '${TAG_PREFIX}*' --sort=-creatordate | head -1`,
      {
        encoding: 'utf8',
        shell: true,
      }
    ).trim()
  } catch {
    // No tags yet
    lastTag = ''
  }

  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
  let commits
  try {
    commits = execSync(`git log ${range} --pretty=format:"%s" --no-merges`, {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return { added: [], changed: [], fixed: [], other: [] }
  }

  // Categorize commits by conventional commit prefixes
  const categories = {
    added: [],
    changed: [],
    fixed: [],
    other: [],
  }

  for (const commit of commits) {
    const lower = commit.toLowerCase()
    // Skip release commits
    if (lower.startsWith('release ')) continue

    if (
      lower.startsWith('feat:') ||
      lower.startsWith('feat(') ||
      lower.startsWith('add:') ||
      lower.startsWith('add ')
    ) {
      categories.added.push(cleanCommitMessage(commit))
    } else if (
      lower.startsWith('fix:') ||
      lower.startsWith('fix(') ||
      lower.startsWith('bugfix:')
    ) {
      categories.fixed.push(cleanCommitMessage(commit))
    } else if (
      lower.startsWith('change:') ||
      lower.startsWith('refactor:') ||
      lower.startsWith('update:') ||
      lower.startsWith('improve:')
    ) {
      categories.changed.push(cleanCommitMessage(commit))
    } else {
      categories.other.push(cleanCommitMessage(commit))
    }
  }

  return categories
}

/**
 * Clean up commit message for changelog
 */
function cleanCommitMessage(message) {
  return (
    message
      // Remove conventional commit prefixes
      .replace(
        /^(feat|fix|change|refactor|update|add|improve)(\([^)]+\))?:\s*/i,
        ''
      )
      // Capitalize first letter
      .replace(/^./, (c) => c.toUpperCase())
      // Remove trailing period if present (we'll add our own)
      .replace(/\.$/, '')
  )
}

/**
 * Format changelog entries for a version
 */
function formatChangelogEntries(categories) {
  const sections = []

  if (categories.added.length > 0) {
    sections.push(
      '### Added\n\n' + categories.added.map((c) => `- ${c}`).join('\n')
    )
  }
  if (categories.changed.length > 0 || categories.other.length > 0) {
    const allChanged = [...categories.changed, ...categories.other]
    sections.push(
      '### Changed\n\n' + allChanged.map((c) => `- ${c}`).join('\n')
    )
  }
  if (categories.fixed.length > 0) {
    sections.push(
      '### Fixed\n\n' + categories.fixed.map((c) => `- ${c}`).join('\n')
    )
  }

  return sections.join('\n\n')
}

/**
 * Update CHANGELOG.md with commits since last tag
 * @param {string} newVersion - The new version number
 * @param {string} previousVersion - The previous version number
 * @param {string} entries - Pre-formatted changelog entries
 */
function updateChangelog(newVersion, previousVersion, entries) {
  const content = readFileSync(PATHS.changelog, 'utf8')
  const today = new Date().toISOString().split('T')[0]

  if (!entries) {
    console.log('⚠️  No commits found to add to changelog')
    return
  }

  // Build new version section
  const newSection = `## [${newVersion}] - ${today}\n\n${entries}`

  // Find where to insert (after the header, before first version)
  const headerEnd = content.indexOf('\n## [')
  if (headerEnd === -1) {
    console.error('❌ Could not find version section in CHANGELOG.md')
    return
  }

  const header = content.slice(0, headerEnd)
  const rest = content.slice(headerEnd)

  // Update comparison links at the bottom
  const newLink = `[${newVersion}]: https://github.com/${GITHUB_REPO}/compare/${TAG_PREFIX}${previousVersion}...${TAG_PREFIX}${newVersion}`

  // Find where links section starts (after ---)
  const linksStart = rest.lastIndexOf('\n[')
  let updatedRest
  if (linksStart !== -1) {
    updatedRest =
      rest.slice(0, linksStart + 1) + newLink + rest.slice(linksStart)
  } else {
    updatedRest = rest + `\n${newLink}\n`
  }

  const updated = header + '\n' + newSection + updatedRest

  writeFileSync(PATHS.changelog, updated)
  console.log(`✅ Updated CHANGELOG.md with version ${newVersion}`)
}

/**
 * Get current git branch name
 */
function getCurrentBranch() {
  return execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
  }).trim()
}

/**
 * Create git commit and tag
 */
function gitCommitAndTag(version, dryRun = false) {
  const tag = `${TAG_PREFIX}${version}`
  const staged = [PATHS.packageJson, PATHS.configYaml, PATHS.changelog]
    .filter(Boolean)
    .join(' ')

  // Nothing to bump for a mirrored version, so the release is the tag alone.
  const commands = ADDON.bumpable
    ? [
        `git add ${staged}`,
        `git commit -m "Release ${version}"`,
        `git tag -a ${tag} -m "Release ${version}"`,
      ]
    : [`git tag -a ${tag} -m "Release ${version}"`]

  if (dryRun) {
    console.log('\n🔍 Dry run - would execute:')
    commands.forEach((cmd) => console.log(`  ${cmd}`))
    return
  }

  commands.forEach((cmd) => {
    try {
      execSync(cmd, { stdio: 'inherit' })
    } catch (error) {
      console.error(`❌ Failed to execute: ${cmd}`)
      throw error
    }
  })

  console.log(`✅ Created git tag ${TAG_PREFIX}${version}`)
}

/**
 * Main release function
 */
function release(bumpType, options = {}) {
  const { dryRun = false, push = false } = options

  console.log(
    `\n🚀 Starting release process (${ADDON.dir}${
      bumpType ? `, ${bumpType}` : ''
    })\n`
  )

  // Get current and new version
  const currentVersion = getCurrentVersion()
  const newVersion = ADDON.bumpable
    ? bumpVersion(currentVersion, bumpType)
    : currentVersion

  console.log(`📦 Current version: ${currentVersion}`)
  console.log(`📦 New version: ${newVersion}\n`)

  // Capture commits BEFORE creating any tags (to avoid race condition)
  const categories = getCommitsSinceLastTag()
  const entries = formatChangelogEntries(categories)
  const totalCommits =
    categories.added.length +
    categories.changed.length +
    categories.fixed.length +
    categories.other.length

  if (totalCommits > 0) {
    console.log(`📝 Found ${totalCommits} commits since last tag`)
    if (categories.added.length)
      console.log(`   Added: ${categories.added.length}`)
    if (categories.changed.length)
      console.log(`   Changed: ${categories.changed.length}`)
    if (categories.fixed.length)
      console.log(`   Fixed: ${categories.fixed.length}`)
    if (categories.other.length)
      console.log(`   Other (→ Changed): ${categories.other.length}`)
    console.log('')
  }

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - no files will be modified\n')

    if (entries) {
      console.log('📝 Changelog entries that would be added:\n')
      console.log(entries)
      console.log('')
    } else {
      console.log('⚠️  No commits found to add to changelog\n')
    }

    gitCommitAndTag(newVersion, true)
    console.log(`\n💡 To execute, run: bun scripts/release.js ${bumpType}`)
    return
  }

  // Validate we're on main branch (only for actual releases, not dry-run)
  const currentBranch = getCurrentBranch()
  if (currentBranch !== 'main') {
    console.error(`
❌ Releases must be created from the main branch.

   Current branch: ${currentBranch}

   To release:
   1. Merge your feature branch to main first
   2. git checkout main
   3. git pull origin main
   4. bun scripts/release.js ${bumpType}

   💡 Use --dry-run to preview changes from any branch
`)
    process.exit(1)
  }

  // Check for uncommitted changes
  try {
    execSync('git diff-index --quiet HEAD --')
  } catch {
    console.error(
      '❌ You have uncommitted changes. Commit or stash them first.'
    )
    process.exit(1)
  }

  // A mirrored version is already written by the upstream bump workflow.
  if (ADDON.bumpable) {
    updatePackageJson(newVersion)
    updateConfigYaml(newVersion)
    updateChangelog(newVersion, currentVersion, entries)
  } else {
    console.log(`📦 Publishing ${ADDON.dir} at its current version\n`)
  }

  // Git commit and tag
  gitCommitAndTag(newVersion)

  if (push) {
    console.log('\n📤 Pushing to remote...')
    // Push commit and ONLY the new tag (not all tags)
    execSync(`git push && git push origin ${TAG_PREFIX}${newVersion}`, {
      stdio: 'inherit',
    })
    console.log('✅ Pushed commit and tag to remote')

    // Create GitHub release with changelog notes (using pre-captured entries)
    console.log('\n📦 Creating GitHub release...')
    const releaseNotes = entries || `Release ${newVersion}`

    try {
      execSync(
        `gh release create ${TAG_PREFIX}${newVersion} --title "${TAG_PREFIX}${newVersion}" -R ${GITHUB_REPO} --notes "${releaseNotes.replace(
          /"/g,
          '\\"'
        )}"`,
        {
          stdio: 'inherit',
        }
      )
      console.log(
        '✅ GitHub release created - Docker images will build automatically'
      )
    } catch {
      console.error(
        '⚠️  Failed to create GitHub release. Create manually with:'
      )
      console.log(
        `   gh release create ${TAG_PREFIX}${newVersion} --title "${TAG_PREFIX}${newVersion}" -R ${GITHUB_REPO}`
      )
    }
  } else {
    console.log(`\n💡 To push: git push && git push origin ${TAG_PREFIX}${newVersion}`)
    console.log(
      `💡 Then create release: gh release create ${TAG_PREFIX}${newVersion} -R ${GITHUB_REPO}`
    )
  }

  console.log(`\n🎉 Release ${newVersion} complete!\n`)
}

// Parse CLI arguments
const args = process.argv.slice(2)
const addonArg = args.find((a) => a.startsWith('--addon='))?.split('=')[1]
const bumpType = args.find((a) => ['patch', 'minor', 'major'].includes(a))
const flags = {
  dryRun: args.includes('--dry-run') || args.includes('-d'),
  push: args.includes('--push') || args.includes('-p'),
}

const usage = `
Usage: bun scripts/release.js --addon=<name> [patch|minor|major] [options]

Add-ons:
  trmnl-ha         versioned here; takes a bump type, tags v<version>
  trmnl-terminus   version mirrors the bundled Terminus and is set by the
                   upstream bump workflow, so it takes no bump type and
                   publishes whatever config.yaml already says as
                   terminus-v<version>

Bump types (trmnl-ha only):
  patch   0.0.1 -> 0.0.2 (bug fixes)
  minor   0.0.1 -> 0.1.0 (new features, backwards compatible)
  major   0.0.1 -> 1.0.0 (breaking changes)

Options:
  --dry-run, -d    Show what would be changed without modifying files
  --push, -p       Push commit and tags to remote after release

Examples:
  bun scripts/release.js --addon=trmnl-ha patch
  bun scripts/release.js --addon=trmnl-ha minor --dry-run
  bun scripts/release.js --addon=trmnl-terminus --push
`

// Required rather than defaulted: releasing the wrong add-on is silent, and
// both live in one repo off one tag stream.
if (!addonArg || !ADDONS[addonArg]) {
  console.error(
    `\n❌ Pass --addon=<${Object.keys(ADDONS).join('|')}>\n${usage}`
  )
  process.exit(1)
}

selectAddon(addonArg)

if (ADDON.bumpable && !bumpType) {
  console.error(`\n❌ ${addonArg} needs a bump type\n${usage}`)
  process.exit(1)
}

if (!ADDON.bumpable && bumpType) {
  console.error(
    `\n❌ ${addonArg} takes no bump type - its version mirrors the bundled Terminus release\n${usage}`
  )
  process.exit(1)
}

// Run release
try {
  release(bumpType, flags)
} catch (error) {
  console.error('\n❌ Release failed:', error.message)
  process.exit(1)
}
