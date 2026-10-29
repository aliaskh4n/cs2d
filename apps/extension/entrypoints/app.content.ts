// Same-page companion bridge, restricted to the deployed fork and localhost.
import { defineContentScript } from '#imports'
import type { BlobReply } from '../utils/protocol'
const EXT = 'cs2dv-extension'
const APP = 'cs2dv-app'
const COMMANDS = new Set(['PING','CLOUD_CONFIG','SOURCES_STATE','FACEIT_SYNC','STEAM_SYNC','IMPORT_MATCH'])
export default defineContentScript({
  matches: ['https://aliaskh4n.github.io/cs2d/*','http://localhost/*'],
  main() {
    const query = new URLSearchParams(location.hash.split('?')[1]||'')
    const matchId = query.get('extensionReplay') || new URLSearchParams(location.hash.slice(1)).get('cs2dv')
    let done = false
    async function deliver() {
      if (done || !matchId) return
      done = true
      try {
        const reply = await chrome.runtime.sendMessage({target:'background',type:'GET_BLOB',matchId}) as BlobReply|null
        if (!reply) {post({kind:'download-error',message:'Replay not found in the cloud library'});return}
        const bin = atob(reply.base64); const bytes = new Uint8Array(bin.length)
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i)
        post({kind:'download-start',total:bytes.byteLength})
        window.postMessage({source:EXT,kind:'ingest',fileName:reply.fileName,buffer:bytes.buffer},location.origin,[bytes.buffer])
      } catch(error) { post({kind:'download-error',message:error instanceof Error?error.message:String(error)}) }
    }
    window.addEventListener('message',(event:MessageEvent)=>{
      if(event.source!==window||event.origin!==location.origin||event.data?.source!==APP) return
      if(event.data.kind==='ready') void deliver()
      if(event.data.kind==='connector'&&COMMANDS.has(event.data.command)&&typeof event.data.requestId==='string') {
        const {command,payload,requestId}=event.data
        void chrome.runtime.sendMessage({target:'connector',command,payload}).then(reply=>post({requestId,...reply})).catch(error=>post({requestId,error:String(error)}))
      }
    })
    let tries=0
    const ping=setInterval(()=>{if(done||tries++>20)return clearInterval(ping);post({kind:'hello'})},250)
    post({kind:'hello'})
  },
})
function post(message:Record<string,unknown>) {window.postMessage({source:EXT,...message},location.origin)}
