#!/usr/bin/env node
// Publish a tag release on R2 (issue #427 Phase 3).
//
//   node scripts/r2-publish.mjs --tag=v0.2.8 [--bucket=...] [--public-url=...]
//   [--expect=macos,linux] [--timeout-min=120] [--poll-sec=60]
//
// --expect lists the per-OS legs that must have uploaded before publishing
// (add `windows` once the UTM agent is live; until then releases ship
// macOS+Linux per the issue). Expected artifacts per leg:
//   macos:   openaxe-desktop-<v>.dmg + openaxe-plugin-bundles-macos-<tag>.zip
//   linux:   openaxe-desktop-<v>.deb only — the Linux plugin builds headless
//            (no IGraphics backend, VST3/CLAP SDKs not fetched), so no Linux
//            GUI bundles are produced yet
//   windows: openaxe-desktop-<v>.zip + openaxe-plugin-bundles-windows-<tag>.zip
//
// Steps: poll r2://<bucket>/<tag>/ until all expected files exist → download
// to temp → write sha256sums.txt → merge root manifest.json (SAME schema as
// apps/landing fetch-releases output, with browser_download_url on R2) → upload
// both. Same env credentials as r2-upload.mjs.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Fall back to woodpecker/.env (gitignored) for R2_* creds so a direct
// `node scripts/r2-publish.mjs …` works without exporting them by hand.
function loadDotenv() {
  try {
    const url = new URL('../woodpecker/.env', import.meta.url)
    for (const line of readFileSync(url, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
      if (!m) continue
      const key = m[1]
      const value = m[2].replace(/^["']|["']$/g, '').trim()
      if (key.startsWith('R2_') && !process.env[key]) process.env[key] = value
    }
  } catch {
    /* no .env — rely on the environment */
  }
}
loadDotenv()

const env = (lower, upper) => process.env[lower] ?? process.env[upper] ?? ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseArgs(argv) {
  const opts = {
    tag: process.env.CI_COMMIT_TAG || '',
    bucket: env('r2_bucket', 'R2_BUCKET') || 'openaxe-releases',
    publicUrl: env('r2_public_url', 'R2_PUBLIC_URL'),
    expect: (process.env.RELEASE_EXPECT || 'macos,linux').split(',').filter(Boolean),
    timeoutMin: 120,
    pollSec: 60,
  }
  for (const arg of argv) {
    if (arg.startsWith('--tag=')) opts.tag = arg.slice(6)
    else if (arg.startsWith('--bucket=')) opts.bucket = arg.slice(9)
    else if (arg.startsWith('--public-url=')) opts.publicUrl = arg.slice(13)
    else if (arg.startsWith('--expect=')) opts.expect = arg.slice(9).split(',').filter(Boolean)
    else if (arg.startsWith('--timeout-min=')) opts.timeoutMin = Number(arg.slice(14))
    else if (arg.startsWith('--poll-sec=')) opts.pollSec = Number(arg.slice(11))
    else throw new Error(`Unknown flag: ${arg}`)
  }
  if (!opts.tag) throw new Error('Missing --tag (or CI_COMMIT_TAG)')
  if (!opts.publicUrl) throw new Error('Missing --public-url (or R2_PUBLIC_URL)')
  return opts
}

const LEG_ARTIFACTS = {
  macos: (v, tag) => [`openaxe-desktop-${v}.dmg`, `openaxe-plugin-bundles-macos-${tag}.zip`],
  // Linux plugin bundles don't exist yet (headless build) — deb only.
  linux: (v) => [`openaxe-desktop-${v}.deb`],
  windows: (v, tag) => [`openaxe-desktop-${v}.zip`, `openaxe-plugin-bundles-windows-${tag}.zip`],
}

function rcloneEnv() {
  const access = env('r2_access_key', 'R2_ACCESS_KEY')
  const secret = env('r2_secret_key', 'R2_SECRET_KEY')
  const account = env('r2_account_id', 'R2_ACCOUNT_ID')
  if (!access || !secret || !account) {
    throw new Error('Missing R2 credentials (r2_access_key/_secret_key/_account_id)')
  }
  return {
    ...process.env,
    RCLONE_CONFIG_R2_TYPE: 's3',
    RCLONE_CONFIG_R2_PROVIDER: 'Cloudflare',
    RCLONE_CONFIG_R2_ACCESS_KEY_ID: access,
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: secret,
    RCLONE_CONFIG_R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`,
  }
}

function rclone(args, renv, { stdio = 'pipe' } = {}) {
  return execFileSync('rclone', args, { encoding: 'utf8', stdio, env: renv })
}

// --s3-no-check-bucket: bucket-scoped "Object Read & Write" R2 tokens are
// denied HeadBucket/CreateBucket; the bucket exists, so skip the check.
const NO_CHECK = ['--s3-no-check-bucket']

function listTag(bucket, tag, renv) {
  try {
    const out = rclone(['lsf', `r2:${bucket}/${tag}/`], renv)
    return new Set(
      out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  } catch {
    return new Set()
  }
}

function contentType(name) {
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (name.endsWith('.deb')) return 'application/x-debian-package'
  if (name.endsWith('.zip')) return 'application/zip'
  if (name.endsWith('.txt')) return 'text/plain'
  if (name.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const version = opts.tag.replace(/^v/, '')
  const renv = rcloneEnv()
  const base = opts.publicUrl.replace(/\/$/, '')
  for (const leg of opts.expect) {
    if (!LEG_ARTIFACTS[leg]) throw new Error(`Unknown leg in --expect: ${leg}`)
  }
  const expected = [
    ...new Set(opts.expect.flatMap((leg) => LEG_ARTIFACTS[leg](version, opts.tag))),
  ].sort()

  console.log(
    `[r2-publish] waiting for ${expected.length} file(s) under r2://${opts.bucket}/${opts.tag}/`,
  )
  const deadline = Date.now() + opts.timeoutMin * 60_000
  for (;;) {
    const present = listTag(opts.bucket, opts.tag, renv)
    const missing = expected.filter((f) => !present.has(f))
    if (missing.length === 0) break
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for: ${missing.join(', ')} (got: ${[...present].join(', ') || 'nothing'})`,
      )
    }
    console.log(`[r2-publish] missing: ${missing.join(', ')} — rechecking in ${opts.pollSec}s`)
    await sleep(opts.pollSec * 1000)
  }

  const work = mkdtempSync(join(tmpdir(), 'r2-publish-'))
  try {
    const assets = []
    for (const name of expected) {
      const local = join(work, name)
      rclone(['copyto', `r2:${opts.bucket}/${opts.tag}/${name}`, local, ...NO_CHECK], renv, {
        stdio: 'inherit',
      })
      const buf = readFileSync(local)
      const sha = createHash('sha256').update(buf).digest('hex')
      assets.push({ name, size: buf.length, sha256: sha, url: `${base}/${opts.tag}/${name}` })
    }
    const sums = assets.map((a) => `${a.sha256}  ${a.name}`).join('\n') + '\n'
    writeFileSync(join(work, 'sha256sums.txt'), sums)
    rclone(
      [
        'copyto',
        join(work, 'sha256sums.txt'),
        `r2:${opts.bucket}/${opts.tag}/sha256sums.txt`,
        ...NO_CHECK,
      ],
      renv,
      {
        stdio: 'inherit',
      },
    )

    let manifest = { generated_at: new Date().toISOString(), releases: [] }
    try {
      const raw = rclone(['cat', `r2:${opts.bucket}/manifest.json`], renv)
      manifest = JSON.parse(raw)
      if (!Array.isArray(manifest.releases)) manifest.releases = []
    } catch {
      console.log('[r2-publish] no existing manifest — starting fresh')
    }
    const entry = {
      tag_name: opts.tag,
      name: opts.tag,
      published_at: new Date().toISOString(),
      prerelease: false,
      html_url: `${base}/${opts.tag}/`,
      body: '',
      assets: assets.map((a) => ({
        name: a.name,
        size: a.size,
        download_count: 0,
        browser_download_url: a.url,
        content_type: contentType(a.name),
      })),
    }
    manifest.generated_at = new Date().toISOString()
    manifest.releases = [entry, ...manifest.releases.filter((r) => r.tag_name !== opts.tag)]
    writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    rclone(
      ['copyto', join(work, 'manifest.json'), `r2:${opts.bucket}/manifest.json`, ...NO_CHECK],
      renv,
      {
        stdio: 'inherit',
      },
    )
    console.log(
      `[r2-publish] published ${opts.tag} (${assets.length} assets) → ${base}/${opts.tag}/`,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (err) {
  console.error(`[r2-publish] FATAL: ${err.message}`)
  process.exit(1)
}
