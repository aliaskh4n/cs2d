// Production browser smoke: Pages paths, reports, highlights, bzip2 and no local replay database.
import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readdir, mkdir } from 'node:fs/promises'
const base = process.env.CS2D_TEST_URL || 'http://127.0.0.1:4174/cs2d/'
const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const context = await browser.newContext({locale:'ru-RU',viewport:{width:1440,height:1000}})
const page = await context.newPage()
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
await mkdir('test-results',{recursive:true})
try {
  await page.goto(base+'#/cloud')
  await page.getByRole('heading',{name:'История матчей',exact:true}).waitFor()
  await page.getByRole('link',{name:/Войти через Steam/}).waitFor()
  await page.screenshot({path:'test-results/cloud-desktop.png',fullPage:true})
  await page.goto(base+'#/app/upload?replay=%2Freplays%2Fdust2-preview.json&tab=overview&autoplay=0')
  await page.getByRole('heading',{name:'Статистика матча'}).waitFor()
  assert.ok(await page.locator('tbody tr').count()>0)
  await page.screenshot({path:'test-results/match-overview-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Моменты',exact:true}).click()
  await page.locator('.moment-list').waitFor()
  assert.ok(await page.locator('.moment-card').count()>0)
  {
    await page.locator('.moment-card').first().click()
    await page.waitForFunction(()=>!location.hash.includes('tab=moments'))
    await page.locator('canvas').first().waitFor()
  }
  const dbs=await page.evaluate(async()=>await indexedDB.databases())
  assert.equal(dbs.some(db=>db.name==='cs2dv-demos'||db.name==='cs2dv-ext'),false)
  const assets=await readdir('apps/app/dist/assets')
  const worker=assets.find(name=>name.startsWith('decompress.worker-')&&name.endsWith('.js'))
  assert.ok(worker)
  const decoded=await page.evaluate(async({url,fixture})=>{
    const worker=new Worker(url,{type:'module'})
    const bytes=Uint8Array.from(atob(fixture),c=>c.charCodeAt(0))
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('bzip2 worker timed out'))},20000)
      worker.onmessage=event=>{if(event.data.type!=='result')return;clearTimeout(timer);worker.terminate();event.data.ok?resolve(new TextDecoder().decode(event.data.buffer)):reject(new Error(event.data.error))}
      worker.onerror=error=>{clearTimeout(timer);worker.terminate();reject(new Error(error.message))}
      worker.postMessage({buffer:bytes.buffer},[bytes.buffer])
    })
  },{url:base+'assets/'+worker,fixture:'QlpoOTFBWSZTWQ5PLK8AAAMfgEAAEAAIAAgANirMECAAIoaZPU09TahTAATSJYHdAPiC9lRRXJ0WXxdyRThQkA5PLK8='})
  assert.equal(decoded,'CS2d Steam bzip2 smoke test')
  await page.setViewportSize({width:390,height:844})
  await page.goto(base+'#/cloud')
  await page.getByRole('heading',{name:'История матчей',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:'test-results/cloud-mobile.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log('PASS: cloud UI, match report, highlights seek, Steam bzip2 decoder, mobile layout and no local replay database')
} finally {await browser.close()}
