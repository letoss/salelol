const SUPABASE_URL="https://qeynytijtqzfukoollqi.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_lKlX4veu8Qww6dLupuocFA_elRJ6FGk";
const STORAGE_KEY="salelol-companion-v1";
const invoke=window.__TAURI__.core.invoke;
const $=selector=>document.querySelector(selector);
const form=$("#credentials-form"),connectButton=$("#connect-button"),disconnectButton=$("#disconnect-button");
const statusCard=$(".status-card"),preview=$("#live-preview");
let session=null,pollTimer=null,wasLive=false,lastGameResult=null;

function cleanCredentials(){return {gameName:$("#game-name").value.trim().replace(/\s+/g," ").slice(0,16),tagLine:$("#tag-line").value.trim().replace(/[^a-zA-Z0-9]/g,"").slice(0,5),invitationCode:$("#invite-code").value.trim()};}
function riotId(credentials){return `${credentials.gameName}#${credentials.tagLine}`;}
function setStatus(kind,title,detail){statusCard.className=`status-card ${kind||""}`;$("#status-title").textContent=title;$("#status-detail").textContent=detail;}
function setConnected(connected){connectButton.classList.toggle("hidden",connected);disconnectButton.classList.toggle("hidden",!connected);[...form.querySelectorAll("input")].forEach(input=>input.disabled=connected);}
async function callFunction(name,body){const response=await fetch(`${SUPABASE_URL}/functions/v1/${name}`,{method:"POST",headers:{apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`Error ${response.status}`);return payload;}
async function publish(active,stats=null){if(!session)return;await callFunction("live-stats-update",{name:riotId(session),invitationCode:session.invitationCode,ownerToken:session.ownerToken,active,stats});}
function showLive(stats){preview.classList.remove("hidden");$("#live-champion").textContent=stats.championName;$("#live-kda").textContent=`${stats.kills}/${stats.deaths}/${stats.assists}`;$("#live-extra").textContent=`${stats.creepScore} CS · ${Math.floor(stats.gameTimeSeconds/60)} min${stats.gameMode?` · ${stats.gameMode}`:""}`;}
async function poll(){
  if(!session)return;
  try{
    const stats=await invoke("read_live_stats",{riotId:riotId(session)});
    if(!stats){if(wasLive)await publish(false);wasLive=false;lastGameResult=null;preview.classList.add("hidden");setStatus("connected","Conectado","Esperando que comience una partida de League of Legends…");return;}
    await publish(true,stats);wasLive=true;lastGameResult=stats.gameResult||lastGameResult;showLive(stats);setStatus("live",lastGameResult?lastGameResult==="win"?"Victoria reportada":"Derrota reportada":"Transmitiendo tus stats",lastGameResult?"SaleLoL mostrará el resultado durante dos minutos.":"SaleLoL está recibiendo exclusivamente tus datos en vivo.");
  }catch(error){preview.classList.add("hidden");setStatus("error","No se pudo leer la partida",String(error).replace(/^Error:\s*/,""));}
}
async function connect(credentials){
  if(credentials.gameName.length<3||credentials.tagLine.length<3||credentials.invitationCode.length<4)throw new Error("Completá Riot ID, tag y código de invitación.");
  setStatus("connected","Verificando","Conectando con SaleLoL…");
  const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
  const joined=await callFunction("lobby-join",{name:riotId(credentials),invitationCode:credentials.invitationCode,ownerToken:saved?.name?.toLocaleLowerCase()===riotId(credentials).toLocaleLowerCase()?saved.ownerToken:null});
  session={...credentials,ownerToken:joined.ownerToken};localStorage.setItem(STORAGE_KEY,JSON.stringify({name:riotId(session),...session}));setConnected(true);setStatus("connected","Conectado","Buscando el cliente local de League of Legends…");await poll();pollTimer=setInterval(poll,10_000);
}
form.addEventListener("submit",async event=>{event.preventDefault();connectButton.disabled=true;try{await connect(cleanCredentials());}catch(error){setStatus("error","No se pudo conectar",error.message||String(error));}finally{connectButton.disabled=false;}});
disconnectButton.addEventListener("click",async()=>{clearInterval(pollTimer);pollTimer=null;try{if(wasLive)await publish(false);}catch{}session=null;wasLive=false;preview.classList.add("hidden");setConnected(false);setStatus("","Sin conectar","Ingresá las mismas credenciales que usás en SaleLoL.");});
$("#toggle-secret").addEventListener("click",event=>{const input=$("#invite-code"),visible=input.type==="text";input.type=visible?"password":"text";event.currentTarget.textContent=visible?"MOSTRAR":"OCULTAR";});
$("#tag-line").addEventListener("input",event=>{event.target.value=event.target.value.replace(/[^a-zA-Z0-9]/g,"").slice(0,5);});
try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");if(saved){$("#game-name").value=saved.gameName||"";$("#tag-line").value=saved.tagLine||"";$("#invite-code").value=saved.invitationCode||"";}}catch{}
