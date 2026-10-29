// Reuse a provider tab without depending on a content script injected before installation.
export async function providerTab(pattern: string, url: string): Promise<number> {
  const existing = await chrome.tabs.query({ url: pattern })
  const tab = existing.find(t => t.active) ?? existing[0] ?? await chrome.tabs.create({ url, active: false })
  if (tab.id == null) throw new Error('Could not open the provider. Open its site and retry.')
  if (tab.status === 'complete') return tab.id
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Provider page is still loading. Open it and retry.')) }, 30000)
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed) }
    const updated = (id: number, info: chrome.tabs.TabChangeInfo) => { if (id === tab.id && info.status === 'complete') { cleanup(); resolve() } }
    const removed = (id: number) => { if (id === tab.id) { cleanup(); reject(new Error('Provider tab was closed. Retry the connection.')) } }
    chrome.tabs.onUpdated.addListener(updated)
    chrome.tabs.onRemoved.addListener(removed)
    // Loading can finish between querying the tab and attaching the listener.
    void chrome.tabs.get(tab.id!).then(current => { if (current.status === 'complete') { cleanup(); resolve() } }).catch(() => { cleanup(); reject(new Error('Provider tab is unavailable. Retry.')) })
  })
  return tab.id
}
