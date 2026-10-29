// Only the companion background may request these narrowly scoped, same-origin JSON endpoints.
import { defineContentScript } from '#imports'
export default defineContentScript({matches:['https://www.faceit.com/*'],main(){
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.target!=='faceit-api'||sender.id!==chrome.runtime.id)return false
    const path=message.path
    const allowed=typeof path==='string'&&(/^\/api\/users\/v1\/nicknames\/[\w%-]+$/.test(path)||/^\/api\/stats\/v1\/stats\/time\/users\/[\w-]+\/games\/cs2\?size=100&page=\d+$/.test(path)||/^\/api\/match\/v2\/match\/[\w-]+$/.test(path)||path==='/api/download/v2/demos/download-url')
    if(!allowed){sendResponse({ok:false,error:'Unsupported FACEIT endpoint'});return false}
    const post=path==='/api/download/v2/demos/download-url'
    void fetch(path,{credentials:'include',method:post?'POST':'GET',headers:post?{'Content-Type':'application/json'}:undefined,body:post?JSON.stringify({resource_url:message.body?.resource_url}):undefined}).then(async response=>{
      if(!response.headers.get('content-type')?.includes('json')) {
        sendResponse({ok:false,error:`FACEIT HTTP ${response.status}: open FACEIT, sign in and complete its browser check, then retry.`})
        return
      }
      sendResponse({ok:response.ok,status:response.status,data:await response.json()})
    }).catch(error=>sendResponse({ok:false,error:String(error)}))
    return true
  })
}})
