// publish.ts — publish a built game to sharky.gg under YOUR account.
//
//   bun scripts/publish.ts --html dist/index.html --title "My Game" \
//       [--game-id <existing id to update>] [--min-players 2] [--max-players 8] \
//       [--email <account email>]
//
// CREDENTIALS (v2): first publish asks for your sharky.gg account email and a
// 6-digit code sent to it (use the SAME email your platform account shows in
// its settings — Apple "Hide My Email" accounts must use the relay address).
// The session is stored in ~/.config/sharky-online/session.json (override with
// SHARKY_SESSION_FILE) and refreshes itself; later publishes are zero-prompt.
// This is an independent session chain — it does NOT log you out of the
// sharky.gg website. The skill ships zero secrets: the embedded anon key below
// is the public client key served in every sharky.gg browser bundle.
//
// OPERATOR MODE (platform maintainers only): set SHARKY_ENV_FILE to a platform
// .env carrying SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SHARKY_USER_ID to
// write storage + user_games directly. --host preview / --game-url work only
// in this mode.
//
// HOSTING NOTE: storage serves HTML as text/plain (bucket policy), so
// game_url must point at a text/html host. Default: the platform /play
// route — permanent, cache-busted via ?v=<hash>.
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as readline from 'node:readline/promises'

// Public platform constants (the anon key is the public browser-bundle key —
// safe to ship; it grants nothing beyond what any sharky.gg visitor has).
const SUPABASE_URL = 'https://yhvgdxuwxyergytakxvn.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlodmdkeHV3eHllcmd5dGFreHZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxMDM0MzcsImV4cCI6MjA2MjY3OTQzN30.wr_wxValc6HSAIaIVOiSYmKWMAdMbHzBWWqR0IFprHk'
const DEFAULT_API_BASE = 'https://prod-game-maker.sharky.gg'

const args: Record<string, string> = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] ?? ''

const htmlPath = resolve(args.html || 'dist/index.html')
const title = args.title || 'Untitled Sharky Game'
const minPlayers = Number(args['min-players']) || 2
const maxPlayers = Number(args['max-players']) || 8
const apiBase = (args['api-base'] || process.env.SHARKY_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '')

const html = readFileSync(htmlPath, 'utf8')
if (!/window\.__DELTA_GAME_CONFIG__\s*=/.test(html)) {
  throw new Error('built HTML missing the sim shim — run scripts/build.ts first')
}
// The server-side sim refuses oversized pages (SIM_MAX_HTML_BYTES: 2MB stock,
// 6MB on current prod relays) — publish would succeed but rooms never sync
// (gotcha 1e: sim_warmup_failed, zero state_updates).
if (html.length > 2_000_000) {
  console.warn(`[publish] WARNING: page is ${(html.length / 1e6).toFixed(2)}MB — sim fetch cap is SIM_MAX_HTML_BYTES (2MB stock / 6MB current prod). Oversized pages publish fine but never sync.`)
}

if (process.env.SHARKY_ENV_FILE) {
  await operatorPublish()
} else {
  if (args.host || args['game-url']) {
    throw new Error('--host / --game-url are operator-mode options (set SHARKY_ENV_FILE); account publishing always uses the permanent /play route')
  }
  await userPublish()
}

// ---------------------------------------------------------------------------
// user mode (default): email-OTP session + platform import endpoint
// ---------------------------------------------------------------------------

type Session = {
  access_token: string
  refresh_token: string
  expires_at: number // ms epoch
  email: string
  user_id: string
  supabase_url: string
}

function sessionPath(): string {
  return process.env.SHARKY_SESSION_FILE || join(homedir(), '.config', 'sharky-online', 'session.json')
}

function loadSession(): Session | null {
  try {
    const s = JSON.parse(readFileSync(sessionPath(), 'utf8')) as Session
    if (!s?.access_token || !s?.refresh_token) return null
    if (s.supabase_url && s.supabase_url !== SUPABASE_URL) {
      console.warn(`[auth] stored session targets ${s.supabase_url}, expected ${SUPABASE_URL} — ignoring it`)
      return null
    }
    return s
  } catch {
    return null
  }
}

function saveSession(s: Session) {
  const file = sessionPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
  chmodSync(file, 0o600)
}

function toSession(tokens: any, emailFallback: string): Session {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    email: tokens.user?.email ?? emailFallback,
    user_id: tokens.user?.id ?? '',
    supabase_url: SUPABASE_URL,
  }
}

async function authFetch(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const resp = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: resp.ok, status: resp.status, json: await resp.json().catch(() => ({})) }
}

// Supabase rotates refresh tokens: each refresh invalidates the old one, so
// the rotated pair is saved immediately. This chain is independent of any
// browser session (gotcha 5) — refreshing here never logs the website out.
async function refreshSession(s: Session): Promise<Session | null> {
  const r = await authFetch('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token })
  if (!r.ok || !r.json?.access_token) return null
  const next = toSession(r.json, s.email)
  saveSession(next)
  return next
}

async function otpLogin(): Promise<Session> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const email = (args.email || (await rl.question('sharky.gg account email: '))).trim()
    if (!email.includes('@')) throw new Error('a valid email is required')

    const sent = await authFetch('/auth/v1/otp', { email, create_user: true })
    if (!sent.ok) {
      throw new Error(`could not send the code (${sent.status}): ${JSON.stringify(sent.json).slice(0, 200)}`)
    }
    console.log(`[auth] 6-digit code sent to ${email} — use the email your sharky.gg account settings show`)

    const code = (await rl.question('6-digit code: ')).trim()
    let v = await authFetch('/auth/v1/verify', { email, token: code, type: 'email' })
    if (!v.ok) {
      // older GoTrue versions only accept the pre-consolidation type names
      v = await authFetch('/auth/v1/verify', { email, token: code, type: 'magiclink' })
    }
    if (!v.ok || !v.json?.access_token) {
      throw new Error(`code verification failed (${v.status}): ${JSON.stringify(v.json).slice(0, 200)}`)
    }
    const session = toSession(v.json, email)
    saveSession(session)
    console.log(`[auth] signed in as ${session.email} — session stored in ${sessionPath()}`)
    return session
  } finally {
    rl.close()
  }
}

async function ensureSession(): Promise<Session> {
  const existing = loadSession()
  if (existing) {
    if (existing.expires_at - 60_000 > Date.now()) return existing
    const refreshed = await refreshSession(existing)
    if (refreshed) return refreshed
    console.warn('[auth] stored session could not be refreshed — signing in again')
  }
  return otpLogin()
}

async function callImport(accessToken: string): Promise<{ status: number; json: any }> {
  const resp = await fetch(`${apiBase}/api/v1/games/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      html,
      title,
      minPlayers,
      maxPlayers,
      ...(args['game-id'] ? { gameId: args['game-id'] } : {}),
    }),
  })
  return { status: resp.status, json: await resp.json().catch(() => ({})) }
}

async function userPublish() {
  let session = await ensureSession()
  let result = await callImport(session.access_token)
  if (result.status === 401) {
    // token may have just expired mid-flight; refresh (or re-login) once
    session = (await refreshSession(session)) ?? (await otpLogin())
    result = await callImport(session.access_token)
  }
  if (result.status !== 200) {
    throw new Error(`publish failed (${result.status}): ${result.json?.error ?? JSON.stringify(result.json).slice(0, 200)}`)
  }

  const out = result.json
  if (out.warning) console.warn(`[publish] WARNING: ${out.warning}`)
  console.log(`\n✅ ${out.updated ? 'updated' : 'published'} — account: ${out.email || session.email}`)
  printFooter(out.gameId)
}

// ---------------------------------------------------------------------------
// operator mode (SHARKY_ENV_FILE): direct storage + user_games writes
// ---------------------------------------------------------------------------

async function operatorPublish() {
  const envFile = process.env.SHARKY_ENV_FILE!
  const env: Record<string, string> = {}
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  const OP_SUPABASE_URL = env.SUPABASE_URL
  const KEY = env.SUPABASE_SERVICE_ROLE_KEY
  const BUCKET = env.STORAGE_BUCKET || 'game-apps'
  const OWNER = env.SHARKY_USER_ID
  if (!OP_SUPABASE_URL || !KEY || !OWNER) throw new Error(`missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SHARKY_USER_ID in ${envFile}`)

  const gameId = args['game-id'] || randomUUID()
  const isUpdate = !!args['game-id']
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 12)

  async function uploadStorage(path: string, body: string, contentType: string) {
    const resp = await fetch(`${OP_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'content-type': contentType, 'x-upsert': 'true' },
      body,
    })
    if (!resp.ok) throw new Error(`upload ${path} failed ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
    return `${OP_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
  }

  // 1. storage artifacts
  await uploadStorage(`${gameId}/index.html`, html, 'text/html; charset=utf-8')
  const now = new Date().toISOString()
  const sourceArtifact = {
    version: 1,
    codeStore: null,
    gameCode: html, // full HTML — the platform sim extracts the embedded config (old-pipeline convention)
    gameCodeHash: hash,
    designSpec: { title, description: 'Published via sharky-online skill (free-form HTML + sync bus).', minPlayers, maxPlayers },
    generatedAssets: {},
    metadataTrace: { source: 'sharky-online-skill', sourceVersion: hash },
    requestedCapabilities: [],
    sdkVersion: 'v3',
    sourceVersion: hash,
    bgmUrl: null,
    createdAt: now,
    updatedAt: now,
  }
  await uploadStorage(`${gameId}/source/latest.json`, JSON.stringify(sourceArtifact, null, 2), 'application/json')
  console.log('[storage] artifacts uploaded for', gameId)

  // 2. hosting (game_url must serve text/html — the sim reads the config from it)
  let gameUrl = args['game-url'] || ''
  if (!gameUrl && args.host === 'preview') {
    const prev = await fetch(`${DEFAULT_API_BASE}/api/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html }),
    })
    const pj: any = await prev.json()
    if (!pj.id) throw new Error('preview host failed: ' + JSON.stringify(pj).slice(0, 200))
    gameUrl = `${DEFAULT_API_BASE}/api/preview/${pj.id}`
    console.warn('[hosting] PREVIEW host — expires in ~30 minutes. Testing only.')
  }
  if (!gameUrl) {
    // ?v busts the sim's per-game_url source cache so re-publishes take effect
    // for new rooms immediately (the /play route ignores the query).
    gameUrl = `${DEFAULT_API_BASE}/play/${gameId}?v=${hash}`
    const check = await fetch(gameUrl, { method: 'GET' })
    if (!check.ok || !(check.headers.get('content-type') || '').includes('text/html')) {
      throw new Error(`play route not serving this game (${check.status}) — is /play deployed and the storage upload done?`)
    }
    console.log('[hosting] permanent /play route:', gameUrl)
  }

  // 3. user_games row
  const row: Record<string, unknown> = {
    user_id: OWNER,
    title,
    desc: `${title} — published via sharky-online skill`,
    app_prompt: `${title} (free-form HTML, sync-bus multiplayer)`,
    app_status: 'ready',
    mode: 'web_app',
    authority_mode: 'server_sim',
    min_players: minPlayers,
    max_players: maxPlayers,
    private: 0,
    deleted: 0,
    source: 'web',
    build_pipeline: 'nodejs_worker',
    game_url: gameUrl,
    source_version: hash,
  }
  const url = isUpdate
    ? `${OP_SUPABASE_URL}/rest/v1/user_games?id=eq.${gameId}`
    : `${OP_SUPABASE_URL}/rest/v1/user_games`
  const resp = await fetch(url, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'content-type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(isUpdate ? row : { id: gameId, ...row }),
  })
  if (!resp.ok) throw new Error(`user_games ${isUpdate ? 'update' : 'insert'} failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`)

  console.log(`\n✅ ${isUpdate ? 'updated' : 'published'} (operator mode)`)
  printFooter(gameId)
}

function printFooter(gameId: string) {
  console.log('GAME_ID=' + gameId)
  console.log('PLAY=https://sharky.gg/game/' + gameId)
  console.log('MULTIPLAYER: opening the game card starts a FRESH room — players join')
  console.log('together only via the Invite button / the full URL with its instance_id.')
  console.log('\nNext: bun scripts/room-test.ts --game-id ' + gameId + '   # automated 2-client room check')
}
