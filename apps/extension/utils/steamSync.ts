import { providerTab } from './providerTab'
import { steamPage } from './steamPage'
import { discoverSteam, sources } from './connectors'
import { cloudFetch } from './cloud'

let running: Promise<{ count: number; loginRequired?: boolean; error?: string }> | undefined
export function syncSteamHistory(force = false) {
  if (running) return running
  running = sync(force).finally(() => { running = undefined })
  return running
}
async function sync(force: boolean) {
  const state = await sources()
  if (!force && state.steam?.checkedAt && Date.now() - state.steam.checkedAt < 300000) return { count: state.matches.filter(m => m.source === 'steam').length, loginRequired: state.steam.loginRequired, error: state.steam.error }
  const { steamId } = await cloudFetch<{steamId: string}>('/me')
  const tabId = await providerTab('https://steamcommunity.com/*', `https://steamcommunity.com/profiles/${steamId}/gcpd/730/?tab=matchhistorypremier`)
  const matches = []
  let loginRequired = false
  let error: string | undefined
  for (const mode of ['premier','competitive','wingman']) {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: steamPage, args: ['fetch', steamId, mode] })
      const result = results[0]?.result
      if (!result) throw new Error('No Steam response')
      matches.push(...result.matches)
      if (result.loginRequired) { loginRequired = true; break }
      if (result.error) { error = result.error; break }
    } catch { error = 'Could not read the Steam tab. Allow Steam access in the extension settings and retry.'; break }
  }
  await discoverSteam(steamId, matches, { checkedAt: Date.now(), loginRequired, error })
  return { count: matches.length, loginRequired, error }
}
