// Route authenticated FACEIT calls through its own tab so origin and SameSite cookies stay native.
export async function faceitJson(path: string, body?: unknown): Promise<any> {
  if (location.hostname === 'www.faceit.com' || location.hostname === 'faceit.com') {
    const response = await fetch(path, { credentials: 'include', method: body ? 'POST' : 'GET', headers: body ? {'Content-Type':'application/json'} : undefined, body: body ? JSON.stringify(body) : undefined })
    if (!response.ok) throw new Error(`FACEIT HTTP ${response.status}. Sign in on FACEIT and retry.`)
    return response.json()
  }
  const tabs = await chrome.tabs.query({url:'https://www.faceit.com/*'})
  let tab = tabs[0]
  if (!tab?.id) {
    tab = await chrome.tabs.create({url:'https://www.faceit.com/ru/players/Al1askhan',active:false})
    if (tab.status !== 'complete') await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(listener);reject(new Error('Open FACEIT, sign in and retry.'))},30000)
      function listener(id:number,change:chrome.tabs.TabChangeInfo){if(id===tab.id&&change.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(listener);resolve()}}
      chrome.tabs.onUpdated.addListener(listener)
    })
  }
  let reply: {ok:boolean;status?:number;data?:any;error?:string}|undefined
  for(let attempt=0;attempt<5;attempt++) {
    try {reply=await chrome.tabs.sendMessage(tab.id!,{target:'faceit-api',path,body});break} catch(error){if(attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,300))}
  }
  if (!reply?.ok) throw new Error(reply?.error||`FACEIT HTTP ${reply?.status??'error'}. Sign in on FACEIT and retry.`)
  return reply.data
}
