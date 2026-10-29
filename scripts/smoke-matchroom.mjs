// Isolated browser fixtures: populated match history and installed companion provider recovery.
// No real provider cookies, cloud sessions or personal demos are used.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const base=process.env.CS2D_TEST_URL||'http://localhost:4174/cs2d/'
const owner='76561198920126438'
const profile=await mkdtemp(path.join(tmpdir(),'cs2d-companion-qa-'))
const extension=path.resolve('apps/extension/.output/chrome-mv3')
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,locale:'ru-RU',viewport:{width:1440,height:1100},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]})
await mkdir('test-results',{recursive:true})
const player={steamId:owner,name:'Al1askhan',team:'CT',kills:27,deaths:14,assists:5,headshots:18,hsPercent:66.7,damage:2300,adr:95.8,kd:1.93,kast:75,openingKills:4,openingDeaths:1,tripleKills:2,quadKills:1,aces:0,weapons:[{weapon:'deagle',kills:8,headshots:7,hsPercent:87.5}]}
const rows=[['de_mirage','win',13,8,'faceit'],['de_nuke','loss',10,13,'steam'],['de_dust2','draw',12,12,'steam']].map(([map,outcome,myScore,opponentScore,source],index)=>({id:`fixture-${index}`,fileName:'long_unreadable_original_demo_name.dem',fileSize:70000,map,rounds:24,scoreCt:13,scoreT:8,myScore,opponentScore,outcome,storage:'cloud',savedAt:Date.now(),date:Date.now()-index*86400000,source,sourceId:index===0?'faceit-fixture':`existing-${index}`,hasVoice:index===1,voiceStatus:index===0?'omitted':index===1?'available':'absent',mode:'premier',analysis:{rounds:24,players:[{...player,kills:27-index*5}],moments:[{id:'one'}]}}))
const steamRow=(mode,page=1)=>`<table class="csgo_scoreboard_root"><tr><td class="val_left"><table class="csgo_scoreboard_inner_left"><tbody><tr><td>${mode==='premier'?'Mirage':mode==='competitivepermap'?'Nuke':'Inferno'} <a href="http://replay123.valve.net/730/${mode}_${page}.dem.bz2">Download GOTV Replay</a></td></tr><tr><td>2026-10-28 20:15:00 GMT</td></tr></tbody></table></td></tr></table>`
const steamHtml=mode=>`<!doctype html><html><body><div id="application_config" data-userinfo='${JSON.stringify({logged_in:true,steamid:owner})}'></div><script>g_steamID="${owner}";g_sessionID="isolatedtestsession";g_sGcContinueToken='next-page';</script>${steamRow(mode)}</body></html>`
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker')
  // Intercept background cloud requests at their source so fixtures never touch live private storage.
  await worker.evaluate(({owner,rows})=>{
    const original=globalThis.fetch
    globalThis.fetch=async(input,init)=>{
      const url=String(input instanceof Request?input.url:input)
      if(url.includes('cs2d-cloud.tatokz2006.workers.dev/me'))return Response.json({steamId:owner})
      if(url.includes('cs2d-cloud.tatokz2006.workers.dev/matches'))return Response.json({matches:rows,totalBytes:210000,maxBytes:536870912})
      return original(input,init)
    }
  },{owner,rows})
  await context.route('https://cs2d-cloud.tatokz2006.workers.dev/**',route=>route.fulfill({json:{matches:rows,totalBytes:210000,maxBytes:536870912,steamId:owner},headers:{'access-control-allow-origin':'*'}}))
  await context.route('https://www.faceit.com/**',route=>{
    const url=new URL(route.request().url())
    if(url.pathname.includes('/api/match/v2/match/'))return route.fulfill({json:{payload:{demoURLs:['https://demos.faceit.com/resource.dem.gz']}}})
    if(url.pathname.includes('/api/download/v2/demos/download-url'))return route.fulfill({json:{payload:{download_url:'http://replay123.valve.net/730/faceit-voice.dem.bz2'}}})
    if(url.pathname.includes('/api/users/v1/nicknames/'))return route.fulfill({json:{payload:{id:'fixture-user',nickname:'Al1askhan'}}})
    if(url.pathname.includes('/api/stats/v1/stats/time/'))return route.fulfill({json:[{matchId:'faceit-fixture',i1:'de_mirage',date:1793217600000,i6:27,i13:18,c4:66.7}]})
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>FACEIT fixture: no API message receiver installed</body></html>'})
  })
  await context.route('https://steamcommunity.com/**',route=>{
    const url=new URL(route.request().url());const mode=url.searchParams.get('tab')?.replace('matchhistory','')||'premier'
    if(url.searchParams.has('continue_token'))return route.fulfill({json:{success:true,html:steamRow(mode,2)+'<table><td class="val_left"><table class="csgo_scoreboard_inner_left"><tr><td>Old expired match</td></tr></table></td></table>',continue_token:'older'}})
    return route.fulfill({contentType:'text/html',body:steamHtml(mode)})
  })
  // Existing provider tabs have no faceit-api listener. The previous build failed here.
  const faceit=await context.newPage();await faceit.goto('https://www.faceit.com/ru/players/Al1askhan')
  const steam=await context.newPage();await steam.goto(`https://steamcommunity.com/profiles/${owner}/gcpd/730/?tab=matchhistorypremier`)
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{sessionStorage.setItem('cs2d-cloud-session','fixture-not-a-real-session');localStorage.setItem('cs2d-steam-auto','off')})
  await page.goto(base+'#/cloud');await page.locator('.match-row').first().waitFor()
  assert.equal(await page.locator('.match-row').count(),3)
  await page.locator('.connections-heading').click()
  await page.locator('.source-controls button').click();await page.waitForFunction(()=>!document.querySelector('.source-controls button')?.disabled)
  await page.locator('.connected-label').waitFor()
  assert.equal(await page.locator('[role=alert]').count(),0)
  console.log('PASS: FACEIT sync on an existing tab without an API message receiver')
  await page.getByRole('button',{name:/Проверить/}).click()
  await page.waitForFunction(()=>document.body.innerText.includes('Проверено в'))
  const call=(command,payload={})=>page.evaluate(({command,payload})=>new Promise((resolve,reject)=>{
    const requestId=crypto.randomUUID();const timer=setTimeout(()=>reject(Error('connector timed out')),20000)
    window.addEventListener('message',function handler(e){if(e.data?.source==='cs2dv-extension'&&e.data.requestId===requestId){clearTimeout(timer);window.removeEventListener('message',handler);e.data.error?reject(Error(e.data.error)):resolve(e.data.result)}})
    window.postMessage({source:'cs2dv-app',kind:'connector',requestId,command,payload},location.origin)
  }),{command,payload})
  const state=await call('SOURCES_STATE');assert.equal(state.matches.filter(m=>m.source==='steam').length,6)
  assert.ok(state.matches.filter(m=>m.source==='steam').every(m=>m.date&&m.map));assert.equal(state.steam.counts.premier,2);assert.equal(state.steam.expired,3)
  const tabCount=context.pages().length;await call('STEAM_SYNC',{force:true,autoImport:false});assert.equal(context.pages().length,tabCount)
  console.log('PASS: real Steam scoreboard structure, Premier and per-map Competitive, AJAX continuation, counts, expired rows and one reused tab')
  await page.getByRole('button',{name:'Победы',exact:true}).click();assert.equal(await page.locator('.match-row').count(),1)
  await page.getByRole('button',{name:/Все матчи/}).click();assert.equal(await page.locator('.match-row').count(),3)
  await page.locator('.deagle-summary').click();assert.equal(await page.locator('.sort-filter select').inputValue(),'deagle')
  await page.locator('.sort-filter select').selectOption('date')
  const dismiss=page.getByRole('button',{name:'Не сейчас',exact:true});if(await dismiss.isVisible())await dismiss.click()
  await page.locator('.connections-heading').click()
  await page.screenshot({path:'test-results/matchroom-profile-desktop.png',fullPage:true})
  await page.locator('.history-section').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/matchroom-history-desktop.png',fullPage:true})
  for(const width of [1000,390]){
    await page.setViewportSize({width,height:width===390?1000:1100});await page.waitForTimeout(350);await page.locator('.history-section').scrollIntoViewIfNeeded()
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('.match-row,.cloud-page')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className))
    assert.deepEqual(overflow,[])
    await page.screenshot({path:`test-results/matchroom-${width}.png`,fullPage:true})
  }
  await context.route('**/*.valve.net/**',route=>route.fulfill({status:404,body:'Expired test replay'}))
  assert.equal(await page.locator('.voice-row.available').count(),1);assert.equal(await page.locator('.voice-row.absent').count(),1)
  assert.equal(await page.getByRole('button',{name:/Догрузить голос/}).count(),1)
  assert.equal(await page.getByLabel('Сохранять голосовой чат в облачном реплее').isChecked(),true)
  await page.getByRole('button',{name:/Догрузить голос/}).click();await page.waitForFunction(()=>document.body.innerText.includes('Догрузка голоса в очереди'))
  assert.equal(await page.locator('.match-row').count(),3)
  console.log('PASS: voice enabled by default, explicit saved/absent/omitted states, restore command queues the original match without removing it')
  const queued=await call('STEAM_AUTO_IMPORT',{enabled:true});assert.equal(queued.queued,6)
  const outcomes=new Map()
  for(let n=0;n<150;n++) {const current=await call('SOURCES_STATE');for(const j of current.active)if(j.matchId.startsWith('steam-')&&j.error)outcomes.set(j.matchId,j.error);if(outcomes.size===6)break;await page.waitForTimeout(100)}
  assert.equal(outcomes.size,6,JSON.stringify([...outcomes]))
  assert.ok([...outcomes.values()].every(error=>error.includes('HTTP 404')),JSON.stringify([...outcomes]))
  console.log('PASS: Steam auto-import queues new matches, starts the real offscreen processor, and reports expired demos without connection errors')
  // An expired/anonymous Steam session becomes an actionable login state rather than a raw connection error.
  await context.route('https://steamcommunity.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><div id="application_config" data-userinfo='{&quot;logged_in&quot;:false}'></div><script>g_steamID = false;</script><main>Public Steam profile</main>`}))
  const loggedOut=await call('STEAM_SYNC',{force:true,autoImport:false});assert.equal(loggedOut.loginRequired,true)
  assert.deepEqual(errors,[])
  console.log('PASS: populated history, victory filter, Deagle sorting, desktop/tablet/mobile layout, Steam login recovery; no page errors')
} finally {await context.close();await rm(profile,{recursive:true,force:true})}
