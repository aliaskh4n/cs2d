// Exercise the real Worker + SQLite Durable Object, including private access and multipart round trips.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Miniflare } from 'miniflare'
import { fileURLToPath } from 'node:url'
import { signToken, verifyToken, verifySteamResponse } from '../src/auth.mjs'
let mf, token
const secret='isolated-test-session-secret'
const owner='76561198920126438'
const request=(path,init={})=>mf.dispatchFetch('https://cloud.test'+path,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}})
before(async()=>{
  token=await signToken({steamId:owner,exp:Date.now()/1000+3600},secret)
  mf=new Miniflare({modules:true,scriptPath:fileURLToPath(new URL('../src/worker.mjs',import.meta.url)),compatibilityDate:'2026-07-30',bindings:{SESSION_SECRET:secret,APP_URL:'https://aliaskh4n.github.io/cs2d/',OWNER_STEAM_ID:owner,MAX_STORAGE_BYTES:'8388608'},durableObjects:{LIBRARY:{className:'CloudLibrary',useSQLite:true}}})
  await mf.ready
})
after(async()=>{await mf?.dispose()})
test('private records reject anonymous, expired and other-owner sessions',async()=>{
  assert.equal((await mf.dispatchFetch('https://cloud.test/matches')).status,401)
  const wrong=await signToken({steamId:'76561198000000000',exp:Date.now()/1000+3600},secret)
  assert.equal((await request('/matches',{headers:{Authorization:`Bearer ${wrong}`}})).status,401)
  assert.equal(await verifyToken(token+'corrupt',secret),null)
  assert.equal(await verifyToken(await signToken({steamId:owner,exp:1},secret),secret),null)
})
test('CORS refuses unrelated websites and upload metadata contains no credentials',async()=>{
  assert.equal((await request('/matches',{headers:{Origin:'https://attacker.test'}})).status,403)
  const r=await request('/matches',{headers:{Origin:'https://aliaskh4n.github.io'}})
  assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://aliaskh4n.github.io')
})
test('multipart upload remains invisible until all chunks commit, then streams identical bytes',async()=>{
  const bytes=new Uint8Array(700000);for(let i=0;i<bytes.length;i++)bytes[i]=i%251
  const metadata={fileName:'record.cs2dv',map:'de_dust2',rounds:24,scoreCt:13,scoreT:11,fileSize:bytes.length,source:'faceit',sourceId:'test-match',token:'must-not-be-stored',analysis:{rounds:24,players:[],moments:[]}}
  const start=await request('/uploads',{method:'POST',body:JSON.stringify(metadata)});assert.equal(start.status,200)
  const {uploadId,partSize}=await start.json()
  assert.equal((await request(`/uploads/${uploadId}/complete`,{method:'POST'})).status,409)
  assert.equal((await (await request('/matches')).json()).matches.length,0)
  assert.equal((await request(`/uploads/${uploadId}/parts/0`,{method:'PUT',body:bytes.subarray(0,partSize)})).status,200)
  assert.equal((await request(`/uploads/${uploadId}/parts/1`,{method:'PUT',body:bytes.subarray(partSize)})).status,200)
  const committed=await request(`/uploads/${uploadId}/complete`,{method:'POST'});assert.equal(committed.status,200)
  const {id}=await committed.json()
  const matches=await (await request('/matches')).json();assert.equal(matches.totalBytes,bytes.length);assert.equal(matches.matches[0].token,undefined)
  const downloaded=await request(`/matches/${id}/archive`);assert.equal(downloaded.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes)
  assert.equal((await request(`/matches/${id}/comments`,{method:'PUT',body:'[{"text":"nice round"}]'})).status,200)
  assert.deepEqual(await (await request(`/matches/${id}/comments`)).json(),[{text:'nice round'}])
  assert.equal((await request(`/matches/${id}`,{method:'DELETE'})).status,200)
  assert.equal((await (await request('/matches')).json()).totalBytes,0)
  assert.equal((await request(`/matches/${id}/archive`)).status,404)
})
test('invalid part sizes and quota overflow fail without storing partial matches',async()=>{
  const r=await request('/uploads',{method:'POST',body:JSON.stringify({fileName:'x',map:'de_nuke',fileSize:9000000})});assert.equal(r.status,413)
  const {uploadId}=await (await request('/uploads',{method:'POST',body:JSON.stringify({fileName:'x',map:'de_nuke',fileSize:20})})).json()
  assert.equal((await request(`/uploads/${uploadId}/parts/0`,{method:'PUT',body:new Uint8Array(19)})).status,400)
  assert.equal((await request(`/uploads/${uploadId}`,{method:'DELETE'})).status,200)
})
test('OpenID does not accept an unsigned or mismatched Steam identity',async()=>{
  await assert.rejects(verifySteamResponse(new URLSearchParams({'openid.mode':'id_res','openid.op_endpoint':'https://attacker.test'}),'https://cloud.test/auth/callback'))
})
