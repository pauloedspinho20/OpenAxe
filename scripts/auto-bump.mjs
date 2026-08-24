#!/usr/bin/env node
// Determines the next semver from conventional commits since the last tag
// and bumps VERSION + package.json files + CHANGELOG.md.
// Designed to run in CI on push to main — no manual VERSION edits needed.
//
// Rules (semver, with 0.y.z handling — before 1.0 breaking = minor):
//   BREAKING CHANGE or `feat!:` / `fix!:`  → major (0.y.z → 0.(y+1).0, ≥1.0.0 → major)
//   `feat:` / `feat(scope):`               → minor (0.1.0 → 0.2.0)
//   `fix:` / `perf:` / `refactor:` etc.   → patch
//   `chore:` / `docs:` / `ci:` / `build:` → patch (unless BREAKING)
//   No commits since last tag              → no bump (exit 0)
// Usage:
//   node scripts/auto-bump.mjs --dry-run   # print what would happen
//   node scripts/auto-bump.mjs             # write VERSION, sync, update CHANGELOG
//   node scripts/auto-bump.mjs --tag       # also create annotated tag vX.Y.Z
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VERSION_PATH = join(ROOT, 'VERSION')
const CHANGELOG_PATH = join(ROOT, 'CHANGELOG.md')
const DRY_RUN = process.argv.includes('--dry-run')
const DO_TAG = process.argv.includes('--tag')

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT }).trim()
}

function getCurrentVersion() {
  const v = readFileSync(VERSION_PATH, 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Invalid VERSION: ${v}`)
  return v
}

function getLastTag() {
  try {
    return sh('git describe --tags --abbrev=0 --match "v[0-9]*"')
  } catch {
    return null
  }
}

function getCommitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  const log = sh(`git log ${range} --pretty=format:%B%x1e%H%x1e%an%x1f --no-merges`)
  if (!log) return []
  return log.split('\x1f').map((raw) => {
    const [body, hashAndAuthor] = raw.split('\x1e')
    const [hash, author] = (hashAndAuthor || '').split('\x1e')
    const lines = body.trim().split('\n')
    const subject = lines[0] || ''
    return { subject, body: body.trim(), hash, author }
  }).filter(c => c.subject)
}

function determineBump(commits, current) {
  let hasBreaking = false
  let hasFeat = false
  let hasFix = false

  for (const c of commits) {
    const s = c.subject
    const b = c.body
    // BREAKING CHANGE in body or `!` after type/scope
    if (/BREAKING CHANGE:/.test(b) || /BREAKING-CHANGE:/.test(b) || /^[a-z]+(\(.+\))?!:/.test(s)) {
      hasBreaking = true
      break
    }
    if (/^feat(\(.+\))?:/.test(s)) hasFeat = true
    else if (/^(fix|perf|refactor|chore|docs|ci|build|test)(\(.+\))?:/.test(s)) hasFix = true
    else if (s) hasFix = true // unknown type → patch
  }

  const [major, minor] = current.split('.').map(Number)
  if (hasBreaking) return major === 0 ? 'minor' : 'major'
  if (hasFeat) return 'minor'
  if (hasFix) return 'patch'
  return null
}

function incVersion(current, bump) {
  let [major, minor, patch] = current.split('.').map(Number)
  if (bump === 'major') { major += 1; minor = 0; patch = 0 }
  else if (bump === 'minor') { minor += 1; patch = 0 }
  else if (bump === 'patch') { patch += 1 }
  return `${major}.${minor}.${patch}`
}

function updateChangelog(nextVersion, commits, lastTag) {
  if (!existsSync(CHANGELOG_PATH)) return
  let changelog = readFileSync(CHANGELOG_PATH, 'utf8')
  const date = new Date().toISOString().slice(0, 10)
  const header = `## [${nextVersion}] - ${date}`

  const feat = commits.filter(c => /^feat/.test(c.subject))
  const fix = commits.filter(c => /^(fix|perf)/.test(c.subject))
  const other = commits.filter(c => !/^feat/.test(c.subject) && !/^(fix|perf)/.test(c.subject))

  let notes = ''
  if (feat.length) {
    notes += '\n### Added\n'
    for (const c of feat) notes += `- ${c.subject} (${c.hash?.slice(0, 7) || ''})\n`
  }
  if (fix.length) {
    notes += '\n### Fixed\n'
    for (const c of fix) notes += `- ${c.subject} (${c.hash?.slice(0, 7) || ''})\n`
  }
  if (other.length) {
    notes += '\n### Changed\n'
    for (const c of other) notes += `- ${c.subject} (${c.hash?.slice(0, 7) || ''})\n`
  }
  if (!notes) notes = `\n- ${commits.length} commit(s) since ${lastTag || 'initial'}\n`

  const entry = `${header}${notes}\n`
  // Insert after ## [Unreleased] section
  if (changelog.includes('## [Unreleased]')) {
    changelog = changelog.replace('## [Unreleased]', `## [Unreleased]\n\n${entry}`)
  } else {
    changelog = entry + '\n' + changelog
  }
  if (DRY_RUN) {
    console.log('--- CHANGELOG preview ---\n' + entry)
  } else {
    writeFileSync(CHANGELOG_PATH, changelog)
  }
}

// ── main ──
const current = getCurrentVersion()
const lastTag = getLastTag()
const commits = getCommitsSince(lastTag)

console.log(`Current version: ${current}`)
console.log(`Last tag: ${lastTag || '(none)'}`)
console.log(`Commits since last tag: ${commits.length}`)
commits.slice(0, 10).forEach(c => console.log(`  - ${c.subject}`))
if (commits.length > 10) console.log(`  ... and ${commits.length - 10} more`)

if (commits.length === 0) {
  console.log('No commits since last tag — nothing to bump.')
  process.exit(0)
}

const bump = determineBump(commits, current)
if (!bump) {
  console.log('No relevant commits — skipping bump.')
  process.exit(0)
}

const next = incVersion(current, bump)
console.log(`Bump: ${bump} → ${current} → ${next}`)

if (DRY_RUN) {
  console.log(`(dry-run) would write VERSION=${next}, run sync-version, update CHANGELOG`)
  process.exit(0)
}

// write VERSION
writeFileSync(VERSION_PATH, next + '\n')
console.log(`Wrote ${VERSION_PATH} → ${next}`)

// sync package.json files
sh('node scripts/sync-version.mjs')
console.log('Synced package.json files via sync-version.mjs')

// update CHANGELOG
updateChangelog(next, commits, lastTag)
console.log('Updated CHANGELOG.md')

if (DO_TAG) {
  sh(`git add VERSION CHANGELOG.md package.json apps/web/package.json apps/desktop/package.json packages/ui/package.json`)
  sh(`git commit -m "chore(release): ${next}"`)
  sh(`git tag -a v${next} -m "v${next}"`)
  console.log(`Committed and tagged v${next}`)
  console.log('Push with: git push && git push --tags')
}
