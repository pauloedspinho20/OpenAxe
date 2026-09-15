#!/usr/bin/env node
// Upload release artifacts to Cloudflare R2 via rclone (issue #427 Phase 3).
//
//   node scripts/r2-upload.mjs --tag=v0.2.8 [--bucket=openaxe-releases] [--public-url=https://pub-....r2.dev] <file-or-glob>...
//
// Env (Woodpecker user secrets `r2_access_key/_secret_key/_account_id_;
// UPPERCASE variants also accepted for terminal use):
//   r2_access_key / R2_ACCESS_KEY, r2_secret_key / R2_SECRET_KEY,
//   r2_account_id / R2_ACCOUNT_ID, R2_BUCKET / --bucket,
//   R2_PUBLIC_URL / --public-url (printed only, for the release notes).
// --tag defaults to process.env.CI_COMMIT_TAG (never pass $VAR through YAML).
//
// Layout: r2://<bucket>/<tag>/<basename>. Requires `rclone` on PATH
// (mac: `brew install rclone`; linux: docker/ci-linux image; win: winget).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

// Fall back to woodpecker/.env (gitignored) for R2_* creds so a direct
// `node scripts/r2-upload.mjs …` works without exporting them by hand.
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

function parseArgs(argv) {
  const opts = {
    tag: process.env.CI_COMMIT_TAG || '',
    bucket: env('r2_bucket', 'R2_BUCKET') || 'openaxe-releases',
    publicUrl: env('r2_public_url', 'R2_PUBLIC_URL'),
    patterns: [],
  }
  for (const arg of argv) {
    if (arg.startsWith('--tag=')) opts.tag = arg.slice(6)
    else if (arg.startsWith('--bucket=')) opts.bucket = arg.slice(9)
    else if (arg.startsWith('--public-url=')) opts.publicUrl = arg.slice(13)
    else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`)
    else opts.patterns.push(arg)
  }
  return opts
}

// Tiny single-`*` glob (basename only) — no shell/pwsh expansion differences.
function expand(pattern) {
  if (!pattern.includes('*')) {
    if (!existsSync(pattern)) throw new Error(`Artifact not found: ${pattern}`)
    return [pattern]
  }
  const dir = dirname(pattern) === '' ? '.' : dirname(pattern)
  const rx = new RegExp('^' + basename(pattern).split('*').map(escapeRx).join('.*') + '$')
  const hits = readdirSync(dir)
    .filter((f) => rx.test(f) && statSync(`${dir}/${f}`).isFile())
    .map((f) => `${dir}/${f}`)
  if (hits.length === 0) throw new Error(`Nothing matched: ${pattern}`)
  return hits
}
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
    RCLONE_CONFIG_R2_ACL: 'private',
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.tag) throw new Error('Missing --tag (or CI_COMMIT_TAG)')
  if (opts.patterns.length === 0) throw new Error('No artifacts given')
  const files = [...new Set(opts.patterns.flatMap(expand))]
  const renv = rcloneEnv()
  console.log(`[r2-upload] ${files.length} file(s) → r2://${opts.bucket}/${opts.tag}/`)
  for (const f of files) {
    const dest = `r2:${opts.bucket}/${opts.tag}/${basename(f)}`
    console.log(`[r2-upload] ${f} → ${dest}`)
    // --s3-no-check-bucket: bucket-scoped "Object Read & Write" R2 tokens are
    // denied HeadBucket/CreateBucket; the bucket exists, so skip the check.
    execFileSync('rclone', ['copyto', f, dest, '--checksum', '--s3-no-check-bucket'], {
      stdio: 'inherit',
      env: renv,
    })
  }
  if (opts.publicUrl) {
    console.log(`[r2-upload] public dir: ${opts.publicUrl.replace(/\/$/, '')}/${opts.tag}/`)
  }
}

try {
  main()
} catch (err) {
  console.error(`[r2-upload] FATAL: ${err.message}`)
  process.exit(1)
}
