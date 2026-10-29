// Match statistics and replay moments derived from recorded events, without a server or invented ratings.
import type { KillEvent, Replay, Round, Side } from './schema'

export interface WeaponStats { weapon: string; kills: number; headshots: number; hsPercent: number }
export interface PlayerStats {
  steamId: string; name: string; team: Side; kills: number; deaths: number; assists: number
  headshots: number; hsPercent: number; damage: number; adr: number; kd: number; kast: number
  openingKills: number; openingDeaths: number; tripleKills: number; quadKills: number; aces: number
  weapons: WeaponStats[]
}
export interface MatchMoment {
  id: string; kind: 'ace' | 'multikill' | 'deagle' | 'clutch'; steamId: string; name: string
  roundIndex: number; roundNumber: number; t: number; endT: number; kills: number
  headshots: number; opponents?: number; priority: number
}
export interface MatchAnalysis { rounds: number; players: PlayerStats[]; moments: MatchMoment[] }

export function weaponCode(value: string): string {
  const code = value.toLowerCase().replace(/^weapon_/, '').replace(/[ -]/g, '_')
  return code === 'desert_eagle' || code === 'deserteagle' ? 'deagle' : code
}

function sidesOf(round: Round): Map<string, Side> {
  const sides = new Map<string, Side>()
  for (const frame of [...round.frames.filter(f => f.tick >= round.startTick), ...round.frames]) {
    for (const p of frame.players) if (!sides.has(p.steamId)) sides.set(p.steamId, p.side)
  }
  return sides
}

function pregame(round: Round): boolean {
  return round.frames.length === 0 && round.events.length === 0 || round.frames.length > 0 && round.frames.every(
    f => f.players.every(p => !p.weapon || /^(faca|knife.*)$/i.test(p.weapon)),
  )
}

export function analyzeMatch(replay: Replay): MatchAnalysis {
  let first = 0
  while (first < replay.rounds.length && pregame(replay.rounds[first])) first++
  if (first === replay.rounds.length) first = 0
  const reference = replay.rounds[first]
  const initialSides = reference ? sidesOf(reference) : new Map<string, Side>()
  const players = new Map<string, PlayerStats>(replay.players.map(p => [p.steamId, {
    steamId: p.steamId, name: p.name, team: initialSides.get(p.steamId) ?? p.startSide,
    kills: 0, deaths: 0, assists: 0, headshots: 0, hsPercent: 0, damage: 0, adr: 0, kd: 0, kast: 0,
    openingKills: 0, openingDeaths: 0, tripleKills: 0, quadKills: 0, aces: 0, weapons: [],
  }]))
  const moments: MatchMoment[] = []
  const roundsPlayed = new Map<string, number>()
  const kastRounds = new Map<string, number>()
  let rounds = 0
  replay.rounds.forEach((round, roundIndex) => {
    if (roundIndex < first || (!round.frames.length && !round.events.length)) return
    rounds++
    const sides = sidesOf(round)
    for (const p of replay.players) if (!sides.has(p.steamId)) sides.set(p.steamId, p.startSide)
    const events = round.events.filter((e): e is KillEvent => e.type === 'kill' && e.tick >= round.startTick)
      .sort((a, b) => a.tick - b.tick)
    const enemyKill = (e: KillEvent) => !!e.attackerSteamId && e.attackerSteamId !== e.victimSteamId &&
      e.weapon !== 'world' && sides.get(e.attackerSteamId) !== sides.get(e.victimSteamId) &&
      players.has(e.attackerSteamId) && players.has(e.victimSteamId)
    const duels = events.filter(enemyKill)
    const opening = duels[0]
    if (opening?.attackerSteamId) {
      players.get(opening.attackerSteamId)!.openingKills++
      players.get(opening.victimSteamId)!.openingDeaths++
    }
    for (const e of events) {
      const victim = players.get(e.victimSteamId)
      if (victim) victim.deaths++
      if (!enemyKill(e)) continue
      const attacker = players.get(e.attackerSteamId!)!
      attacker.kills++
      if (e.headshot) attacker.headshots++
      const code = weaponCode(e.weapon)
      let weapon = attacker.weapons.find(w => w.weapon === code)
      if (!weapon) attacker.weapons.push(weapon = { weapon: code, kills: 0, headshots: 0, hsPercent: 0 })
      weapon.kills++
      if (e.headshot) weapon.headshots++
      if (e.assisterSteamId && e.assisterSteamId !== e.attackerSteamId && sides.get(e.assisterSteamId) === sides.get(e.attackerSteamId!)) {
        const assister = players.get(e.assisterSteamId)
        if (assister) assister.assists++
      }
    }
    const participants = new Set(round.frames.flatMap(frame => frame.players.map(p => p.steamId)))
    for (const e of events) { participants.add(e.victimSteamId); if (e.attackerSteamId) participants.add(e.attackerSteamId); if (e.assisterSteamId) participants.add(e.assisterSteamId) }
    const alive = new Set(participants)
    const clutch = new Map<string, { opponents: number; t: number }>()
    for (const e of events) {
      alive.delete(e.victimSteamId)
      for (const id of alive) {
        const side = sides.get(id)
        const teammates = [...alive].filter(x => sides.get(x) === side).length
        const opponents = [...alive].filter(x => sides.get(x) !== side).length
        if (teammates === 1 && opponents >= 2 && !clutch.has(id)) clutch.set(id, { opponents, t: e.t })
      }
    }
    for (const p of players.values()) {
      if (!participants.has(p.steamId)) continue
      const own = duels.filter(e => e.attackerSteamId === p.steamId)
      const death = events.find(e => e.victimSteamId === p.steamId)
      const assist = duels.some(e => e.assisterSteamId === p.steamId)
      const traded = death && duels.some(e => e.victimSteamId === death.attackerSteamId && e.t > death.t && e.t <= death.t + 5 && sides.get(e.attackerSteamId!) === sides.get(p.steamId))
      roundsPlayed.set(p.steamId, (roundsPlayed.get(p.steamId) ?? 0) + 1)
      if (own.length || assist || !death || traded) kastRounds.set(p.steamId, (kastRounds.get(p.steamId) ?? 0) + 1)
      p.damage += round.damage?.[p.steamId] ?? 0
      if (own.length === 3) p.tripleKills++
      if (own.length === 4) p.quadKills++
      if (own.length >= 5) p.aces++
      const deagles = own.filter(e => weaponCode(e.weapon) === 'deagle')
      const clutchStart = clutch.get(p.steamId)
      const wonClutch = clutchStart && alive.has(p.steamId) && round.winner === sides.get(p.steamId)
      if (own.length < 3 && deagles.length < 2 && !wonClutch) continue
      const kind = wonClutch ? 'clutch' : own.length >= 5 ? 'ace' : deagles.length >= 2 ? 'deagle' : 'multikill'
      const chosen = kind === 'deagle' ? deagles : own
      moments.push({
        id: `${roundIndex}:${p.steamId}:${kind}`, kind, steamId: p.steamId, name: p.name,
        roundIndex, roundNumber: first ? roundIndex - first + 1 : round.number,
        t: Math.max(0, (wonClutch ? clutchStart.t : chosen[0]?.t ?? 0) - 4),
        endT: (chosen.at(-1)?.t ?? clutchStart?.t ?? 0) + 4,
        kills: chosen.length, headshots: chosen.filter(e => e.headshot).length,
        opponents: wonClutch ? clutchStart.opponents : undefined,
        priority: (wonClutch ? clutchStart.opponents * 25 : 0) + own.length * 10 + deagles.length * 4,
      })
    }
  })
  for (const p of players.values()) {
    p.hsPercent = p.kills ? p.headshots / p.kills * 100 : 0
    p.kd = p.deaths ? p.kills / p.deaths : p.kills
    p.adr = p.damage / (roundsPlayed.get(p.steamId) || 1)
    p.kast = (kastRounds.get(p.steamId) ?? 0) / (roundsPlayed.get(p.steamId) || 1) * 100
    for (const w of p.weapons) w.hsPercent = w.headshots / w.kills * 100
    p.weapons.sort((a, b) => b.kills - a.kills || b.headshots - a.headshots)
  }
  return { rounds, players: [...players.values()].sort((a, b) => b.kills - a.kills || b.damage - a.damage), moments: moments.sort((a, b) => b.priority - a.priority) }
}
