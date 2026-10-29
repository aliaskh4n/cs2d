// Private cloud replay library. Only compressed replays are persisted; the PC keeps no demo files.
import { DurableObject } from 'cloudflare:workers'
import { signToken, verifyToken, verifySteamResponse } from './auth.mjs'

const PART_SIZE = 512 * 1024
const MAX_ARCHIVE = 64 * 1024 * 1024
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const app = new URL(env.APP_URL)
    const origin = request.headers.get('Origin')
    const allowed = !origin || origin === app.origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || (url.hostname === 'localhost' && /^http:\/\/localhost:\d+$/.test(origin))
    if (!allowed) return json({ error: 'Origin not allowed' }, 403)
    const cors = response => {
      const headers = new Headers(response.headers)
      if (origin) headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Vary', 'Origin')
      headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type')
      headers.set('Cache-Control', 'no-store')
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, headers })
    }
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    try {
      if (url.pathname === '/health') return cors(json({ ok: true, storage: 'cloud-sqlite', maxBytes: Number(env.MAX_STORAGE_BYTES), loginReady: !!env.SESSION_SECRET }))
      if (url.pathname === '/auth/steam') {
        const state = crypto.randomUUID()
        const returnTo = `${url.origin}/auth/callback?state=${state}`
        const login = new URL('https://steamcommunity.com/openid/login')
        login.search = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo, 'openid.realm': url.origin, 'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' }).toString()
        const cookie = await signToken({ state, exp: Date.now() / 1000 + 600 }, env.SESSION_SECRET)
        return new Response(null, { status: 302, headers: { Location: login.href, 'Set-Cookie': `cs2d_state=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`, 'Cache-Control': 'no-store' } })
      }
      if (url.pathname === '/auth/callback') {
        const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)cs2d_state=([^;]+)/)?.[1]
        const state = await verifyToken(cookie ?? '', env.SESSION_SECRET)
        if (!state || state.state !== url.searchParams.get('state')) return json({ error: 'Login expired; try again from the site' }, 403)
        const returnTo = `${url.origin}/auth/callback?state=${state.state}`
        const steamId = await verifySteamResponse(url.searchParams, returnTo)
        if (steamId !== env.OWNER_STEAM_ID) return json({ error: 'This is a private library for its owner' }, 403)
        const token = await signToken({ steamId, exp: Date.now() / 1000 + 86400 }, env.SESSION_SECRET)
        const target = new URL(env.APP_URL)
        target.hash = `/cloud?session=${encodeURIComponent(token)}`
        return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': 'cs2d_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
      }
      const session = await verifyToken(request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '', env.SESSION_SECRET)
      if (session?.steamId !== env.OWNER_STEAM_ID) return cors(json({ error: 'Sign in with Steam to access your cloud library' }, 401))
      const stub = env.LIBRARY.get(env.LIBRARY.idFromName(session.steamId))
      return cors(await stub.fetch(request))
    } catch (e) {
      console.error('Cloud request failed', e instanceof Error ? e.message : 'Unknown error')
      return cors(json({ error: 'The cloud request could not be completed. Please retry.' }, 500))
    }
  },
}

export class CloudLibrary extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec('CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, upload_id TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, expected INTEGER NOT NULL, created INTEGER NOT NULL)')
    this.sql.exec('CREATE TABLE IF NOT EXISTS parts (upload_id TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(upload_id, part))')
    this.sql.exec('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, comments TEXT NOT NULL)')
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname.split('/').filter(Boolean)
    if (path[0] === 'me') return json({ steamId: this.env.OWNER_STEAM_ID })
    if (path[0] === 'matches' && !path[1] && request.method === 'GET') {
      const matches = [...this.sql.exec('SELECT id, metadata, size, created FROM matches ORDER BY created DESC')].map(r => ({ ...JSON.parse(r.metadata), id: r.id, fileSize: r.size, savedAt: r.created, storage: 'cloud' }))
      return json({ matches, totalBytes: matches.reduce((n, m) => n + m.fileSize, 0), maxBytes: Number(this.env.MAX_STORAGE_BYTES) })
    }
    if (path[0] === 'uploads' && !path[1] && request.method === 'POST') {
      const body = await request.json()
      const { fileSize, fileName, map, rounds, scoreCt, scoreT, hasVoice, analysis, source, sourceId } = body
      if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_ARCHIVE || typeof fileName !== 'string' || fileName.length > 240 || typeof map !== 'string') return json({ error: 'Invalid replay metadata or archive exceeds 64 MiB' }, 400)
      if (typeof sourceId === 'string' && ['faceit','steam'].includes(source)) {
        const existing = [...this.sql.exec("SELECT id FROM matches WHERE json_extract(metadata,'$.source')=? AND json_extract(metadata,'$.sourceId')=? LIMIT 1",source,sourceId)][0]
        if (existing) return json({existingId: existing.id})
      }
      const used = this.sql.exec('SELECT COALESCE(SUM(size),0) AS size FROM matches').one().size
      const pending = this.sql.exec('SELECT COALESCE(SUM(expected),0) AS size FROM uploads').one().size
      if (used + pending + fileSize > Number(this.env.MAX_STORAGE_BYTES)) return json({ error: 'Cloud library is full. Remove a replay before importing another.' }, 413)
      const details = {}
      for (const field of ['teamCt','teamT','mode','competition']) if (typeof body[field] === 'string') details[field] = body[field].slice(0,120)
      if (Number.isFinite(body.date) && body.date > 0 && body.date <= Date.now() + 86400000) details.date = body.date
      if (['myScore','opponentScore'].every(field => Number.isInteger(body[field]) && body[field] >= 0 && body[field] <= 1000)) {
        details.myScore = body.myScore; details.opponentScore = body.opponentScore
        details.outcome = body.myScore > body.opponentScore ? 'win' : body.myScore < body.opponentScore ? 'loss' : 'draw'
      }
      const metadata = JSON.stringify({ fileName, map, rounds, scoreCt, scoreT, hasVoice: !!hasVoice, analysis, ...details, source: ['faceit', 'steam', 'imported'].includes(source) ? source : 'imported', sourceId: typeof sourceId === 'string' ? sourceId.slice(0,100) : undefined })
      if (metadata.length > 262144) return json({ error: 'Statistics are too large' }, 400)
      const id = crypto.randomUUID()
      this.sql.exec('INSERT INTO uploads VALUES(?,?,?,?)', id, metadata, fileSize, Date.now())
      await this.ctx.storage.setAlarm(Date.now() + 3600000)
      return json({ uploadId: id, partSize: PART_SIZE })
    }
    if (path[0] === 'uploads' && validId(path[1])) {
      const uploadId = path[1]
      const upload = [...this.sql.exec('SELECT * FROM uploads WHERE id=?', uploadId)][0]
      if (!upload) return json({ error: 'Upload not found or expired' }, 404)
      if (path[2] === 'parts' && /^\d+$/.test(path[3] ?? '') && request.method === 'PUT') {
        const part = Number(path[3])
        if (part >= Math.ceil(upload.expected / PART_SIZE)) return json({ error: 'Invalid part index' }, 400)
        const bytes = await request.arrayBuffer()
        const expected = Math.min(PART_SIZE, upload.expected - part * PART_SIZE)
        if (bytes.byteLength !== expected) return json({ error: 'Invalid part length' }, 400)
        this.sql.exec('INSERT OR REPLACE INTO parts VALUES(?,?,?)', uploadId, part, bytes)
        return json({ ok: true })
      }
      if (path[2] === 'complete' && request.method === 'POST') {
        const { size, count } = this.sql.exec('SELECT COALESCE(SUM(LENGTH(data)),0) AS size, COUNT(*) AS count FROM parts WHERE upload_id=?', uploadId).one()
        if (size !== upload.expected || count !== Math.ceil(upload.expected / PART_SIZE)) return json({ error: 'Upload is incomplete' }, 409)
        const id = crypto.randomUUID()
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('INSERT INTO matches VALUES(?,?,?,?,?)', id, upload.metadata, uploadId, size, Date.now())
          this.sql.exec('DELETE FROM uploads WHERE id=?', uploadId)
        })
        return json({ id })
      }
      if (request.method === 'DELETE') {
        this.sql.exec('DELETE FROM parts WHERE upload_id=?', uploadId)
        this.sql.exec('DELETE FROM uploads WHERE id=?', uploadId)
        return json({ ok: true })
      }
    }
    if (path[0] === 'matches' && validId(path[1])) {
      const id = path[1]
      const match = [...this.sql.exec('SELECT * FROM matches WHERE id=?', id)][0]
      if (!match) return json({ error: 'Replay not found' }, 404)
      if (path[2] === 'comments') {
        if (request.method === 'GET') return json(JSON.parse([...this.sql.exec('SELECT comments FROM notes WHERE id=?', id)][0]?.comments ?? '[]'))
        if (request.method === 'PUT') {
          const value = await request.text()
          if (value.length > 262144 || !Array.isArray(JSON.parse(value))) return json({ error: 'Invalid comments' }, 400)
          this.sql.exec('INSERT OR REPLACE INTO notes VALUES(?,?)', id, value)
          return json({ ok: true })
        }
      }
      if (path[2] === 'archive' && request.method === 'GET') {
        let part = 0
        const sql = this.sql
        const stream = new ReadableStream({ pull(controller) {
          const row = [...sql.exec('SELECT data FROM parts WHERE upload_id=? AND part=?', match.upload_id, part++)][0]
          if (row) controller.enqueue(new Uint8Array(row.data))
          else controller.close()
        } })
        return new Response(stream, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(match.size), 'Cache-Control': 'no-store' } })
      }
      if (request.method === 'DELETE' && !path[2]) {
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('DELETE FROM parts WHERE upload_id=?', match.upload_id)
          this.sql.exec('DELETE FROM notes WHERE id=?', id)
          this.sql.exec('DELETE FROM matches WHERE id=?', id)
        })
        return json({ ok: true })
      }
      if (request.method === 'PUT' && !path[2]) {
        const { title } = await request.json()
        if (typeof title !== 'string' || title.length > 240) return json({ error: 'Invalid title' }, 400)
        this.sql.exec('UPDATE matches SET metadata=? WHERE id=?', JSON.stringify({ ...JSON.parse(match.metadata), title }), id)
        return json({ ok: true })
      }
    }
    return json({ error: 'Not found' }, 404)
  }

  async alarm() {
    const expired = [...this.sql.exec('SELECT id FROM uploads WHERE created<?', Date.now() - 3600000)]
    for (const { id } of expired) {
      this.sql.exec('DELETE FROM parts WHERE upload_id=?', id)
      this.sql.exec('DELETE FROM uploads WHERE id=?', id)
    }
    if (this.sql.exec('SELECT COUNT(*) AS count FROM uploads').one().count) await this.ctx.storage.setAlarm(Date.now() + 3600000)
  }
}
