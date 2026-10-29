// Scan Steam history when a user opens it; automatic background sync uses the same parser.
import { defineContentScript } from '#imports'
import { steamPage } from '../utils/steamPage'
export default defineContentScript({
  matches: ['https://steamcommunity.com/*/gcpd/730*'],
  main() {
    const steamId = location.pathname.match(/\/profiles\/(7656119\d{10})\/gcpd\/730/)?.[1]
    const mode = new URLSearchParams(location.search).get('tab')?.replace('matchhistory','')
    if (!steamId || !mode || !['premier','competitive','wingman'].includes(mode)) return
    let previous = ''
    async function scan() {
      const result = await steamPage('scan',steamId!,mode!)
      if (result.error || result.loginRequired) return
      const snapshot = JSON.stringify(result.matches)
      if (previous === snapshot) return
      previous = snapshot
      try { await chrome.runtime.sendMessage({target:'connector',command:'STEAM_DISCOVER',payload:{steamId,matches:result.matches}}) } catch { /* next automatic sync also discovers these matches */ }
    }
    let debounce: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(()=>{clearTimeout(debounce);debounce=setTimeout(scan,750)})
    observer.observe(document.body,{childList:true,subtree:true});void scan()
  },
})
