// Discover actual replay links from Steam Personal Game Data; Steam login remains on steamcommunity.com.
import { defineContentScript } from '#imports'
import { validSteamDemo, type SourceMatch } from '../utils/connectors'
export default defineContentScript({
  matches: ['https://steamcommunity.com/*/gcpd/730*'],
  main() {
    const steamId = location.pathname.match(/\/profiles\/(7656119\d{10})\/gcpd\/730/)?.[1]
    if (!steamId) return
    let previous: string | null = null
    function scan() {
      const matches: SourceMatch[] = []
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (!validSteamDemo(anchor.href)) continue
        const url = new URL(anchor.href)
        const file = url.pathname.split('/').pop() ?? ''
        const id = file.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,100)
        const row = anchor.closest('.csgo_scoreboard_root, .matchhistory_match, table')
        const text = row?.textContent ?? ''
        const map = text.match(/\b(?:de|cs)_\w+\b/)?.[0]
        matches.push({ id, source: 'steam', label: map ? `${map} · ${file}` : file, map, url: anchor.href })
      }
      const snapshot = JSON.stringify(matches.map(m => m.id))
      if (previous === snapshot) return
      previous = snapshot
      void chrome.runtime.sendMessage({ target: 'connector', command: 'STEAM_DISCOVER', payload: { steamId, matches } }).then(() => {
        let badge = document.getElementById('cs2d-cloud-status')
        if (!badge) { badge = document.createElement('div'); badge.id = 'cs2d-cloud-status'; badge.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;padding:16px 20px;border:1px solid #64d6c7;border-radius:10px;background:#101820;color:#b8efe5;font:13px sans-serif;max-width:320px'; document.body.append(badge) }
        badge.textContent = `CS2d Cloud: ${matches.length} replay links found. Return to your cloud library to import them.`
      }).catch(() => {})
    }
    let debounce: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(() => { clearTimeout(debounce); debounce = setTimeout(scan,750) })
    observer.observe(document.body,{childList:true,subtree:true}); scan()
  },
})
