// Regression tests for weapon records, changing sides, non-duel deaths and recorded moments.
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMatch, weaponCode } from '../src/matchAnalysis.ts'
import type { Replay, Round, KillEvent } from '../src/schema.ts'
const ids = ['a','b','c','d','e','f']
function kill(attacker: string|null, victim: string, t: number, weapon='deagle', headshot=true): KillEvent {
  return {type:'kill',tick:100+t*64,t,attackerSteamId:attacker,victimSteamId:victim,assisterSteamId:null,assistedFlash:false,weapon,headshot,x:0,y:0,z:0}
}
function round(events: KillEvent[], swapped=false): Round {
  return {number:1,startTick:100,freezeStartTick:0,decidedTick:10000,endTick:11000,postEndTick:12000,winner:swapped?'T':'CT',damage:{a:200},utilityDamage:{},events,
    frames:[{tick:100,t:0,players:ids.map(id=>({steamId:id,side:(id==='a'||id==='b') !== swapped?'CT':'T',weapon:'AK-47'}))}],bomb:[],grenadePaths:[],blinds:[],chat:[],defuses:[],groundWeapons:[],scoreCt:0,scoreT:0,ctName:'A',tName:'B',reason:null} as unknown as Round
}
function replay(rounds:Round[]):Replay {return {map:'de_mirage',demoTickRate:64,frameRate:8,players:ids.map(id=>({steamId:id,name:id,startSide:id==='a'||id==='b'?'CT':'T'})),rounds,finalScoreCt:13,finalScoreT:7,finalCtName:'A',finalTName:'B',generatedBy:'test'} as Replay}
test('weapon records count actual enemy kills and exact headshots, across side switches',()=>{
  const report=analyzeMatch(replay([round([kill('a','c',1),kill('a','d',2,'deagle',false),kill('a','e',3,'ak47')]),round([kill('a','c',1,'weapon_deagle')],true)]))
  const a=report.players.find(p=>p.steamId==='a')!
  assert.equal(a.kills,4);assert.equal(a.headshots,3)
  const deagle=a.weapons.find(w=>w.weapon==='deagle')!;assert.equal(deagle.kills,3);assert.equal(deagle.headshots,2);assert.ok(Math.abs(deagle.hsPercent-200/3)<1e-10)
  assert.equal(a.tripleKills,1);assert.equal(a.openingKills,2);assert.equal(a.adr,200)
  assert.equal(report.moments[0]?.steamId,'a')
})
test('team kills, world deaths and suicides do not inflate weapon records',()=>{
  const report=analyzeMatch(replay([round([kill('a','b',1),kill('a','a',2,'world'),kill(null,'c',3,'world')])]))
  const a=report.players.find(p=>p.steamId==='a')!
  assert.equal(a.kills,0);assert.equal(a.deaths,1);assert.deepEqual(a.weapons,[]);assert.equal(a.hsPercent,0)
  assert.equal(report.moments.length,0)
})
test('clutches require a recorded one-versus-many situation, survival and a round win',()=>{
  const r=round([kill('c','b',1),kill('a','c',2),kill('a','d',3),kill('a','e',4),kill('a','f',5)])
  const moments=analyzeMatch(replay([r])).moments
  assert.equal(moments[0]?.kind,'clutch');assert.equal(moments[0]?.opponents,4)
  r.winner='T'
  assert.notEqual(analyzeMatch(replay([r])).moments[0]?.kind,'clutch')
})
test('knife openers are excluded and real round indices stay seekable',()=>{
  const knife=round([kill('a','c',1,'knife')]);for(const f of knife.frames)for(const p of f.players)p.weapon='Faca'
  const report=analyzeMatch(replay([knife,round([kill('a','c',5),kill('a','d',8)])]))
  assert.equal(report.rounds,1);assert.equal(report.players.find(p=>p.steamId==='a')?.kills,2)
  assert.equal(report.moments[0]?.roundIndex,1);assert.equal(report.moments[0]?.roundNumber,1);assert.equal(report.moments[0]?.t,1)
})
test('weapon names normalize without confusing Deagle with another weapon',()=>{assert.equal(weaponCode('Desert Eagle'),'deagle');assert.equal(weaponCode('weapon_deagle'),'deagle');assert.equal(weaponCode('revolver'),'revolver')})
