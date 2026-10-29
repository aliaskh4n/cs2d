<script setup lang="ts">
// Match report: recorded statistics, weapon filters and seekable highlights.
import { computed, ref } from 'vue'
import { analyzeMatch, type MatchMoment } from '@cs2/replay-core/matchAnalysis'
import type { Replay } from '@/viewer/domain/schema'
import { useI18n } from '@/app/i18n'
import { mapImage, prettyMap } from '@/viewer/domain/demoMeta'
const props = defineProps<{ replay: Replay; mode?: 'overview' | 'moments' }>()
const emit = defineEmits<{ jump: [moment: MatchMoment] }>()
const { t } = useI18n()
const report = computed(() => analyzeMatch(props.replay))
const selected = ref(props.replay.players.find(p => p.steamId === '76561198920126438')?.steamId ?? '')
const weapon = ref('all')
const currentPlayer = computed(() => report.value.players.find(p => p.steamId === selected.value) ?? report.value.players[0])
const weapons = computed(() => currentPlayer.value?.weapons ?? [])
const filteredMoments = computed(() => report.value.moments.filter(m => (!selected.value || m.steamId === selected.value) && (weapon.value !== 'deagle' || m.kind === 'deagle')))
const leader = computed(() => report.value.players[0])
const pct = (n: number) => `${n.toFixed(1)}%`
function momentTitle(m: MatchMoment) {
  return m.kind === 'clutch' ? `1v${m.opponents}` : m.kind === 'deagle' ? `${m.kills}K · Desert Eagle` : m.kind === 'ace' ? 'ACE' : `${m.kills}K`
}
</script>

<template>
  <div class="report-scroll">
    <div class="report-content">
      <header class="match-hero" :style="{ backgroundImage: `linear-gradient(90deg, #0a0c12 10%, #0a0c12b8), url('${mapImage(replay.map)}')` }">
        <div><p class="eyebrow">{{ t('matchroom.report') }}</p><h1>{{ prettyMap(replay.map) }}</h1><p>{{ report.rounds }} {{ t('analyzer.menu.rounds') }} · {{ t('matchroom.recorded') }}</p></div>
        <div class="final-score"><span>{{ replay.finalCtName || 'CT' }}</span><strong>{{ replay.finalScoreCt }} <i>:</i> {{ replay.finalScoreT }}</strong><span>{{ replay.finalTName || 'T' }}</span></div>
      </header>
      <div v-if="mode !== 'moments'" class="report-metrics">
        <article><small>{{ t('matchroom.topFragger') }}</small><strong>{{ leader?.name ?? '—' }}</strong><span>{{ leader?.kills ?? 0 }} K · {{ Math.round(leader?.adr ?? 0) }} ADR</span></article>
        <article><small>{{ t('matchroom.totalKills') }}</small><strong>{{ report.players.reduce((n,p) => n+p.kills,0) }}</strong><span>{{ t('matchroom.enemyKills') }}</span></article>
        <article><small>{{ t('matchroom.bestMoments') }}</small><strong>{{ report.moments.length }}</strong><span>{{ t('matchroom.momentTypes') }}</span></article>
      </div>
      <section v-if="mode !== 'moments'" class="report-panel">
        <div class="section-heading"><h2>{{ t('matchroom.scoreboard') }}</h2><span>{{ t('matchroom.noRating') }}</span></div>
        <div class="table-scroll"><table><thead><tr><th>{{ t('matchroom.player') }}</th><th>K / D / A</th><th>K/D</th><th>ADR</th><th>HS</th><th>HS%</th><th>KAST</th><th>{{ t('matchroom.openings') }}</th><th>3K / 4K / 5K</th></tr></thead>
          <tbody><tr v-for="p in report.players" :key="p.steamId" :class="{ selected: selected === p.steamId }" @click="selected = p.steamId">
            <td><button type="button" @click="selected = p.steamId"><i :class="p.team.toLowerCase()" />{{ p.name }}</button></td><td class="bright">{{ p.kills }} / {{ p.deaths }} / {{ p.assists }}</td><td>{{ p.kd.toFixed(2) }}</td><td>{{ p.adr.toFixed(1) }}</td><td>{{ p.headshots }}</td><td>{{ pct(p.hsPercent) }}</td><td>{{ pct(p.kast) }}</td><td>{{ p.openingKills }} / {{ p.openingDeaths }}</td><td>{{ p.tripleKills }} / {{ p.quadKills }} / {{ p.aces }}</td>
          </tr></tbody></table></div>
      </section>
      <div class="analysis-filters"><label>{{ t('matchroom.player') }}<select v-model="selected"><option value="">{{ t('matchroom.allPlayers') }}</option><option v-for="p in report.players" :key="p.steamId" :value="p.steamId">{{ p.name }}</option></select></label><label>{{ t('matchroom.weapon') }}<select v-model="weapon"><option value="all">{{ t('matchroom.allWeapons') }}</option><option value="deagle">Desert Eagle</option></select></label></div>
      <section v-if="mode !== 'moments'" class="report-panel"><div class="section-heading"><h2>{{ t('matchroom.weapons') }} · {{ currentPlayer?.name }}</h2><span>{{ t('matchroom.weaponHint') }}</span></div><div class="weapon-grid"><article v-for="w in weapons.filter(w => weapon === 'all' || w.weapon === weapon)" :key="w.weapon" :class="{ deagle: w.weapon === 'deagle' }"><small>{{ w.weapon === 'deagle' ? 'Desert Eagle' : w.weapon.toUpperCase() }}</small><strong>{{ w.kills }} <span>K</span></strong><p>{{ w.headshots }} HS · {{ pct(w.hsPercent) }}</p></article><p v-if="!weapons.some(w => weapon === 'all' || w.weapon === weapon)" class="empty-state">{{ t('matchroom.noWeaponKills') }}</p></div></section>
      <section class="report-panel"><div class="section-heading"><h2>{{ t('matchroom.bestMoments') }}</h2><span>{{ t('matchroom.clickMoment') }}</span></div><div class="moment-list"><button v-for="m in filteredMoments" :key="m.id" type="button" class="moment-card" @click="emit('jump',m)"><b>{{ momentTitle(m) }}</b><span><strong>{{ m.name }}</strong><small>{{ t('scoreboard.round') }} {{ m.roundNumber }} · {{ m.headshots }} HS</small></span><em>{{ t('matchroom.watch2d') }} →</em></button><p v-if="!filteredMoments.length" class="empty-state">{{ t('matchroom.noMoments') }}</p></div></section>
    </div>
  </div>
</template>

<style scoped>
.report-scroll{height:100%;overflow:auto;padding:28px 24px 90px;background:#0a0c12}.report-content{max-width:1250px;margin:auto;display:grid;gap:22px}.match-hero{padding:32px;border:1px solid #242b39;border-radius:16px;background-size:cover;background-position:center;display:flex;justify-content:space-between;gap:20px;align-items:center}.eyebrow{font-size:11px!important;text-transform:uppercase;letter-spacing:.18em;color:#64d6c7!important}h1{font-size:32px;font-weight:750;margin:10px 0}h2{font-size:16px;font-weight:650}.match-hero p{font-size:13px;color:#94a0b5}.final-score{text-align:center;display:grid;gap:7px;min-width:230px}.final-score strong{font-size:44px;font-variant-numeric:tabular-nums;color:#f4f7fc}.final-score span{font-size:12px;color:#a6b2c8}.final-score i{font-style:normal;color:#536071;padding:0 15px}.report-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.report-metrics article{border:1px solid #242b39;border-radius:12px;background:#111620;display:grid;gap:8px;padding:20px}.report-metrics small,.weapon-grid small{font-size:11px;color:#8996aa;text-transform:uppercase;letter-spacing:.06em}.report-metrics strong{font-size:27px;color:#f4f7fc;overflow:hidden;text-overflow:ellipsis}.report-metrics span{font-size:12px;color:#8996aa}.report-panel{background:#10151e;border:1px solid #242b39;border-radius:14px;overflow:hidden}.section-heading{padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid #242b39}.section-heading>span{font-size:11px;color:#8996aa}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums}th{font-size:10px;color:#7a889d;letter-spacing:.06em;padding:13px 16px;text-align:right}th:first-child{text-align:left}td{padding:13px 16px;text-align:right;color:#9eabc0;border-top:1px solid #1b2230}td:first-child{text-align:left}td button{display:flex;gap:10px;align-items:center;cursor:pointer;color:#edf4ff;font-weight:600}td button i{width:5px;height:16px;border-radius:2px}.ct{background:#6b9de7}.t{background:#d8bb6e}.bright{color:#e7edf6}tr.selected td{background:#64d6c708}tbody tr:hover{background:#ffffff04}.analysis-filters{display:flex;gap:16px}.analysis-filters label{display:grid;gap:6px;font-size:11px;color:#8c99ad}.analysis-filters select{padding:10px 14px;background:#141b27;color:#e3edfa;border:1px solid #303b4d;border-radius:8px;min-width:190px}.weapon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;padding:18px}.weapon-grid article{padding:16px;border:1px solid #293345;border-radius:10px}.weapon-grid article.deagle{border-color:#64d6c766;background:#64d6c707}.weapon-grid strong{display:block;font-size:28px;margin:10px 0 5px;color:#e8f3ff}.weapon-grid strong span{font-size:12px;color:#708099}.weapon-grid p{font-size:12px;color:#9eabc0}.moment-list{padding:8px 18px}.moment-card{width:100%;padding:15px 0;display:flex;align-items:center;gap:18px;border-bottom:1px solid #222b3a;cursor:pointer;text-align:left}.moment-card:last-child{border:0}.moment-card>b{min-width:100px;color:#64d6c7;font-size:14px}.moment-card>span{display:grid;gap:5px;flex:1}.moment-card strong{font-size:13px;color:#e7edf6}.moment-card small{font-size:11px;color:#7f8da3}.moment-card em{font-style:normal;font-size:12px;color:#9eabc0}.moment-card:hover em{color:#64d6c7}.empty-state{padding:24px;color:#7f8da3;font-size:13px}@media(max-width:680px){.report-scroll{padding:16px 12px 100px}.match-hero{padding:20px;flex-direction:column;align-items:flex-start}.final-score{min-width:0;align-self:center}.report-metrics{grid-template-columns:1fr}.report-metrics article{padding:14px}.report-metrics strong{font-size:22px}.analysis-filters{flex-wrap:wrap}.section-heading{align-items:flex-start;flex-direction:column}.moment-card{gap:10px}.moment-card>b{min-width:72px;font-size:12px}.moment-card em{font-size:10px}}
</style>
