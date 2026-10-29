import type { SourceMatch } from './connectors'

// Self-contained for scripting.executeScript; credentials and continuation tokens stay on Steam.
export async function steamPage(action: 'scan' | 'fetch', steamId: string, mode: string): Promise<{ matches: SourceMatch[]; rows: number; expired: number; pages: number; loginRequired?: boolean; error?: string }> {
  const empty = { matches: [] as SourceMatch[], rows: 0, expired: 0, pages: 0 }
  if (location.hostname !== 'steamcommunity.com' || !/^7656119\d{10}$/.test(steamId) || !['premier','competitive','competitivepermap','wingman'].includes(mode)) return { ...empty, error: 'Invalid Steam history request' }
  const gameMode = mode === 'competitivepermap' ? 'competitive' : mode
  const tab = gameMode === 'competitive' ? 'matchhistorycompetitivepermap' : `matchhistory${gameMode}`
  const matches: SourceMatch[] = []; const seen = new Set<string>()
  let rows = 0; let expired = 0; let pages = 0
  function read(doc: Document) {
    const cells = [...doc.querySelectorAll('td.val_left')].filter(cell => cell.querySelector('.csgo_scoreboard_inner_left'))
    const roots = cells.length ? cells : [...doc.querySelectorAll('.csgo_scoreboard_root, .matchhistory_match')]
    rows += roots.length
    for (const cell of roots) if (![...cell.querySelectorAll('a[href]')].some(a => /\.dem(?:\.(?:bz2|gz|zst))?(?:\?|$)/i.test(a.getAttribute('href') ?? ''))) expired++
    for (const anchor of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      let url: URL
      try { url = new URL(anchor.getAttribute('href')!, 'https://steamcommunity.com') } catch { continue }
      if (!['http:', 'https:'].includes(url.protocol) || !(url.hostname.endsWith('.valve.net') || url.hostname.endsWith('.steamcontent.com')) || !/\.dem(?:\.(?:bz2|gz|zst))?$/i.test(url.pathname)) continue
      const file = url.pathname.split('/').pop() ?? ''; const id = file.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,100)
      if (seen.has(id)) continue
      seen.add(id)
      const row = anchor.closest('td.val_left') ?? anchor.closest('.csgo_scoreboard_root, .matchhistory_match') ?? anchor.closest('table') ?? anchor.parentElement
      const text = row?.textContent?.replace(/\s+/g, ' ') ?? ''
      const artwork = [...(row?.querySelectorAll('img') ?? [])].map(img => `${img.src} ${img.alt}`).join(' ')
      const code = `${text} ${artwork}`.match(/\b(?:de|cs)_\w+\b/i)?.[0]?.toLowerCase()
      const name = text.match(/\b(Dust\s*(?:II|2)|Mirage|Inferno|Nuke|Ancient|Anubis|Overpass|Vertigo|Train|Cache|Office|Italy)\b/i)?.[0]?.toLowerCase().replace(/\s+/g,'').replace('dustii','dust2')
      const map = code ?? (name ? `${['office','italy'].includes(name) ? 'cs' : 'de'}_${name}` : undefined)
      const stamp = row?.querySelector('[data-timestamp], time[datetime]'); const raw = stamp?.getAttribute('data-timestamp')
      const dateText = stamp?.getAttribute('datetime') ?? text.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:GMT|UTC))?)?/)?.[0]
      const date = raw ? Number(raw)*(Number(raw)<1e12 ? 1000 : 1) : dateText ? Date.parse(dateText) : NaN
      matches.push({id,source:'steam',label:map??file,map,date:Number.isFinite(date)?date:undefined,mode:gameMode,url:url.href})
    }
  }
  try {
    let html = document.documentElement.outerHTML
    if (action === 'fetch') {
      // /my/ requests the authenticated account; /profiles/id/ can silently redirect to a public profile.
      const response = await fetch(`/my/gcpd/730?tab=${tab}&l=english`,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)})
      if (!response.ok) return {...empty,error:`Steam HTTP ${response.status}. Open Steam and retry.`}
      if (new URL(response.url).pathname.includes('/login')) return {...empty,loginRequired:true}
      html = await response.text()
    }
    const doc = new DOMParser().parseFromString(html,'text/html')
    let user: {logged_in?: boolean; steamid?: string} = {}
    try { user=JSON.parse(doc.querySelector('#application_config')?.getAttribute('data-userinfo')??'{}') } catch { /* old Steam pages use g_steamID */ }
    const identity = user.steamid ?? html.match(/\bg_steamID\s*=\s*["'](7656119\d{10})["']/)?.[1]
    if (user.logged_in===false || /\bg_steamID\s*=\s*false\b/.test(html) || doc.querySelector('#loginForm, #login_form, form[action*="dologin"]') || /(?:not currently logged in|please (?:log|sign) in to view|not authorized to view)/i.test(doc.body.textContent??'')) return {...empty,loginRequired:true}
    if (identity && identity!==steamId) return {...empty,error:'Steam is signed in to a different account. Sign in to the same Steam account as your cloud library.'}
    const history = doc.querySelector('.csgo_scoreboard_root, .csgo_scoreboard_inner_left, .matchhistory_match, a[href*="tab=matchhistorypremier"]') || /g_sGcContinueToken/.test(html)
    if (!history) return {...empty,error:'Steam returned a profile or an unsupported page instead of CS2 match history. Open the Premier history in Steam and retry.'}
    read(doc);pages++
    if (action==='scan') return {matches,rows,expired,pages}
    let cursor = html.match(/\bg_sGcContinueToken\s*=\s*["']([^"']*)["']/)?.[1]
    const session = html.match(/\bg_sessionID\s*=\s*["']([a-zA-Z0-9]+)["']/)?.[1]
    const cursors = new Set<string>()
    while(cursor && session && pages<40 && !expired && !cursors.has(cursor)) {
      cursors.add(cursor)
      const query=new URLSearchParams({tab,continue_token:cursor,sessionid:session,ajax:'1',l:'english'})
      const response=await fetch(`/my/gcpd/730?${query}`,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(20000)})
      if (!response.ok) return {matches,rows,expired,pages,error:'Steam interrupted history loading. Sign in on Steam and retry.'}
      const next=await response.json()
      if (!next.success || typeof next.html!=='string') return {matches,rows,expired,pages,error:'Steam did not provide the next history page. Retry later.'}
      const before=seen.size
      read(new DOMParser().parseFromString(next.html,'text/html'));pages++
      cursor=typeof next.continue_token==='string'?next.continue_token:undefined
      if(seen.size===before)break
    }
    return {matches,rows,expired,pages}
  } catch {return {matches,rows,expired,pages,error:'Steam history request failed or timed out. Open Steam and retry.'}}
}
