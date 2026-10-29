// Real Opus encode/decode and archive round trip; isolated cloud responses never touch personal data.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpath, readFile } from 'node:fs/promises'
const require=createRequire(await realpath('apps/app/node_modules/vite/package.json'))
const {build}=require('esbuild')
const {outputFiles}=await build({stdin:{contents:"export {exportArchive,importArchive} from './packages/replay-core/src/demoArchive.ts'",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false})
const base=process.env.CS2D_TEST_URL||'http://127.0.0.1:4174/cs2d/'
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const replay=JSON.parse(await readFile('apps/app/public/replays/dust2-preview.json','utf8'))
try {
 const page=await browser.newPage({locale:'ru-RU',viewport:{width:1440,height:1000}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route(base+'voice-qa-module.js',route=>route.fulfill({contentType:'text/javascript',body:outputFiles[0].text}))
 await page.goto(base+'#/cloud')
 const result=await page.evaluate(async({base,replay})=>{
  const {exportArchive,importArchive}=await import(base+'voice-qa-module.js')
  const samples=new Float32Array(4800);for(let n=0;n<samples.length;n++)samples[n]=Math.sin(n*2*Math.PI*440/48000)*0.1
  const encoded=[]
  const encoder=new AudioEncoder({output:chunk=>{const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);encoded.push({bytes,timestamp:chunk.timestamp})},error:error=>{throw error}})
  encoder.configure({codec:'opus',sampleRate:48000,numberOfChannels:1,bitrate:24000})
  const data=new AudioData({format:'f32',sampleRate:48000,numberOfFrames:samples.length,numberOfChannels:1,timestamp:0,data:samples});encoder.encode(data);data.close();await encoder.flush();encoder.close()
  const first=replay.rounds.find(r=>r.frames.length)
  const voice={sampleRate:48000,tickRate:64,tracks:[{steamId:replay.players[0].steamId,packets:encoded.map(p=>({tick:Math.round(first.startTick+p.timestamp/1e6*64),level:-20,data:p.bytes}))}]}
  const archive=await exportArchive({fileName:'voice-fixture.dem',replay,voice,comments:[]})
  const restored=await importArchive(archive)
  if(!restored.meta.hasVoice||restored.voice?.tracks.length!==1)throw Error('Voice missing after archive round trip')
  const original=voice.tracks[0].packets;const packets=restored.voice.tracks[0].packets
  if(original.length!==packets.length||original.some((p,i)=>p.tick!==packets[i].tick||p.data.some((v,j)=>v!==packets[i].data[j])))throw Error('Voice packets changed')
  let energy=0;let frames=0
  const decoder=new AudioDecoder({output:data=>{const pcm=new Float32Array(data.numberOfFrames);data.copyTo(pcm,{planeIndex:0,format:'f32-planar'});for(const sample of pcm)energy+=sample*sample;frames+=pcm.length;data.close()},error:error=>{throw error}})
  decoder.configure({codec:'opus',sampleRate:48000,numberOfChannels:1});for(const p of packets)decoder.decode(new EncodedAudioChunk({type:'key',timestamp:0,data:p.data}));await decoder.flush();decoder.close()
  return {archive:[...new Uint8Array(await archive.arrayBuffer())],energy,frames,packets:packets.length}
 },{base,replay})
 assert.ok(result.energy>0.1);assert.ok(result.frames>=4800);assert.ok(result.packets>0)
 const archive=Buffer.from(result.archive)
 await page.route('https://cs2d-cloud.tatokz2006.workers.dev/**',route=>route.request().url().endsWith('/archive')?route.fulfill({contentType:'application/octet-stream',body:archive,headers:{'access-control-allow-origin':'*'}}):route.fulfill({json:route.request().url().endsWith('/comments')?[]:{matches:[],totalBytes:archive.length,maxBytes:536870912},headers:{'access-control-allow-origin':'*'}}))
 await page.evaluate(()=>sessionStorage.setItem('cs2d-cloud-session','fixture-not-a-real-session'))
 await page.goto(base+'?voice-qa=1#/app/voice-fixture')
 await page.getByRole('button',{name:'Заглушить войс',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Заглушить войс',exact:true}).innerText(),'Голос')
 await page.getByRole('button',{name:'Заглушить войс',exact:true}).click();await page.getByRole('button',{name:'Включить войс',exact:true}).waitFor()
 await page.getByRole('button',{name:'Включить войс',exact:true}).click();await page.getByRole('button',{name:'Заглушить войс',exact:true}).waitFor()
 assert.deepEqual(errors,[])
 console.log(`PASS: real Opus (${result.packets} packets, ${result.frames} decoded samples), exact voice archive round trip, cloud replay hydration and visible Voice playback toggle`)
} finally {await browser.close()}
