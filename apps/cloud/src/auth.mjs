// Steam OpenID identity verification and short-lived, owner-scoped session tokens.
const encoder = new TextEncoder()
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const key = secret => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

export async function signToken(payload, secret) {
  if (!secret) throw new Error('Session signing is not configured')
  const body = encode(encoder.encode(JSON.stringify(payload)))
  return `${body}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body))))}`
}

export async function verifyToken(token, secret) {
  try {
    const parts = token.split('.')
    if (parts.length !== 2 || !secret) return null
    const [body, signature] = parts
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(body))) return null
    const payload = JSON.parse(new TextDecoder().decode(decode(body)))
    return payload.exp > Date.now() / 1000 ? payload : null
  } catch { return null }
}

export async function verifySteamResponse(params, expectedReturnTo, fetcher = fetch) {
  if (params.get('openid.mode') !== 'id_res' || params.get('openid.op_endpoint') !== 'https://steamcommunity.com/openid/login') throw new Error('Invalid Steam response')
  const claimed = params.get('openid.claimed_id') ?? ''
  if (!/^https:\/\/steamcommunity\.com\/openid\/id\/7656119\d{10}$/.test(claimed) || params.get('openid.identity') !== claimed) throw new Error('Invalid Steam identity')
  if (params.get('openid.return_to') !== expectedReturnTo) throw new Error('Invalid Steam return URL')
  const signed = (params.get('openid.signed') ?? '').split(',')
  if (!['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'].every(k => signed.includes(k))) throw new Error('Unsigned Steam identity')
  const body = new URLSearchParams([...params].filter(([k]) => k.startsWith('openid.')))
  body.set('openid.mode', 'check_authentication')
  const response = await fetcher('https://steamcommunity.com/openid/login', { method: 'POST', body, redirect: 'manual' })
  if (!response.ok || !/^is_valid:true\s*$/m.test(await response.text())) throw new Error('Steam could not verify the identity')
  return claimed.split('/').at(-1)
}
