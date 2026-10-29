// Explicit owner-side deployment smoke. Supply a local signing-secret file; no credential is printed.
import { createRequire } from 'node:module'
import { readFile, realpath } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { signToken } from '../apps/cloud/src/auth.mjs'
const secretFile=process.env.CS2D_TEST_SECRET_FILE
if(!secretFile) throw new Error('Set CS2D_TEST_SECRET_FILE to a private local secret file')
const api=process.env.CS2D_TEST_API||'https://cs2d-cloud.tatokz2006.workers.dev'
const token=await signToken({steamId:'76561198920126438',exp:Date.now()/1000+180},(await readFile(secretFile,'utf8')).trim())
const require=createRequire(await realpath('apps/app/node_modules/vite/package.json'))
const {build}=require('esbuild')
const bundle=await build({stdin:{contents:"export {exportArchive,importArchive} from './packages/replay-core/src/demoArchive.ts';export {analyzeMatch} from './packages/replay-core/src/matchAnalysis.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false})
const {exportArchive,importArchive,analyzeMatch}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'))
const replay=JSON.parse(await readFile('apps/app/public/replays/dust2-preview.json','utf8'))
const blob=await exportArchive({fileName:'deployment-smoke.cs2dv',replay,voice:null,comments:[]})
async function request(path,init={}){const response=await fetch(api+path,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}});if(!response.ok)throw new Error(`Cloud HTTP ${response.status} ${await response.text()}`);return response}
assert.equal((await fetch(api+'/matches')).status,401)
const metadata={fileName:'deployment-smoke.cs2dv',map:replay.map,rounds:replay.rounds.length,scoreCt:replay.finalScoreCt,scoreT:replay.finalScoreT,fileSize:blob.size,analysis:analyzeMatch(replay)}
const {uploadId,partSize}=await (await request('/uploads',{method:'POST',body:JSON.stringify(metadata)})).json()
let id
try{
 for(let offset=0,part=0;offset<blob.size;offset+=partSize,part++)await request(`/uploads/${uploadId}/parts/${part}`,{method:'PUT',body:blob.slice(offset,offset+partSize)})
 ;({id}=await (await request(`/uploads/${uploadId}/complete`,{method:'POST'})).json())
 const downloaded=await (await request(`/matches/${id}/archive`)).blob()
 assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),Buffer.from(await blob.arrayBuffer()))
 const archive=await importArchive(downloaded)
 assert.equal(archive.replay.map,replay.map)
 assert.ok(analyzeMatch(archive.replay).moments.length>0)
 const list=await (await request('/matches')).json();assert.ok(list.matches.some(m=>m.id===id))
 console.log(`PASS: live private cloud upload, archive byte comparison, replay decode and highlights (${blob.size} compressed bytes)`)
}finally{
 if(id)await request(`/matches/${id}`,{method:'DELETE'})
 else await request(`/uploads/${uploadId}`,{method:'DELETE'})
}
