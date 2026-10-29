// Route authenticated FACEIT calls through its own tab so origin and SameSite cookies stay native.
import { providerTab } from './providerTab'
import { faceitRequest } from './faceitRequest'
export async function faceitJson(path: string, body?: unknown): Promise<any> {
  let reply: {ok:boolean;status?:number;data?:any;error?:string}|undefined
  if (location.hostname === 'www.faceit.com' || location.hostname === 'faceit.com') reply = await faceitRequest(path, body)
  else {
    const tabId = await providerTab('https://www.faceit.com/*', 'https://www.faceit.com/ru/players/Al1askhan')
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId }, func: faceitRequest, args: [path, body ?? null] })
      reply = results[0]?.result
    } catch { throw new Error('Could not access the FACEIT tab. Allow FACEIT access in the extension settings, open FACEIT and retry.') }
  }
  if (!reply?.ok) throw new Error(reply?.error||`FACEIT HTTP ${reply?.status??'error'}. Sign in on FACEIT and retry.`)
  return reply.data
}
