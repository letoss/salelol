import { remoteStore } from "./data-store.js";

const taunts = ["No seas trolaso", "Los mancos dicen No", "Alto manco", "No podes ser tan cagon", "Saleeee"];
const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const colors = ["#0ac8b9", "#c89b3c", "#d979c7", "#65a9ff", "#ef6b62", "#8bd450", "#ad80ff", "#f29f4b"];
const storeKey = "salelol-state-v2";
const savedRiotIdKey = "salelol-riot-id";
const ownerTokensKey = "salelol-owner-tokens";
const loginCookieKey = "salelol-login-v1";
const loginCookieMaxAge = 14*24*60*60;
const $ = selector => document.querySelector(selector);
const state = loadState();
let currentName = "";
let noClicks = 0;
let draftSlots = new Set();
let availabilityDirty = false;
let selectedDay = (new Date().getDay()+6)%7;

const inviteView = $("#invite-view");
const lobbyView = $("#lobby-view");
const nameInput = $("#summoner-name");
const tagInput = $("#summoner-tag");
const inviteCodeInput = $("#invite-code");
const toggleInviteCode = $("#toggle-invite-code");
const yesButton = $("#yes-button");
const noButton = $("#no-button");
const answerZone = $("#answer-zone");
const installButton = $("#install-button");
const savedCredentials = loadLoginCookie();
const savedRiotId = savedCredentials || loadSavedRiotId();
let installPrompt = null;
let currentOwnerToken = "";
let currentInviteCode = "";
nameInput.value = savedRiotId.gameName;
tagInput.value = savedRiotId.tagLine;
inviteCodeInput.value = savedCredentials?.invitationCode || "";
$("#today-label").textContent = `Semana del ${formatWeekDate(weekStart())}`;

function amsterdamParts() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}
function weekStart() {
  const value = amsterdamParts();
  const date = new Date(Date.UTC(+value.year, +value.month - 1, +value.day));
  const reset = date.getUTCDay() === 0 && +value.hour === 23 && +value.minute >= 59;
  const daysSinceMonday=(date.getUTCDay()+6)%7;
  date.setUTCDate(date.getUTCDate() + (reset ? 1 : -daysSinceMonday));
  return date.toISOString().slice(0, 10);
}
function loadState() { try { const current=weekStart();const saved=JSON.parse(localStorage.getItem(storeKey));if(!saved)return {date:current,players:[],sharedGames:[]};saved.sharedGames||=[];const legacy=new Date(`${current}T00:00:00Z`);legacy.setUTCDate(legacy.getUTCDate()-1);if(saved.date===legacy.toISOString().slice(0,10)){const validSlots=new Set(dayNames.flatMap((_,day)=>slotsForDay(day).map(slot=>slot.id)));saved.players.forEach(player=>{player.slots=(player.slots||[]).filter(slot=>validSlots.has(slot));});saved.date=current;}return saved; } catch { return { date:weekStart(), players:[],sharedGames:[] }; } }
function loadSavedRiotId() { try { const value=JSON.parse(localStorage.getItem(savedRiotIdKey));return {gameName:value?.gameName||"",tagLine:value?.tagLine||""}; } catch { return {gameName:"",tagLine:""}; } }
function loadLoginCookie(){try{const prefix=`${loginCookieKey}=`;const raw=document.cookie.split(";").map(value=>value.trim()).find(value=>value.startsWith(prefix));if(!raw)return null;const value=JSON.parse(decodeURIComponent(raw.slice(prefix.length)));if(typeof value?.gameName!=="string"||typeof value?.tagLine!=="string"||typeof value?.invitationCode!=="string")return null;return value;}catch{return null;}}
function saveLoginCookie(gameName,tagLine,invitationCode){const secure=location.protocol==="https:"?"; Secure":"";const value=encodeURIComponent(JSON.stringify({gameName,tagLine,invitationCode}));document.cookie=`${loginCookieKey}=${value}; Max-Age=${loginCookieMaxAge}; Path=/; SameSite=Strict${secure}`;}
function loadOwnerToken(name) { try { return JSON.parse(localStorage.getItem(ownerTokensKey))?.[name.toLowerCase()]||""; } catch { return ""; } }
function saveOwnerToken(name,token) { const tokens=JSON.parse(localStorage.getItem(ownerTokensKey)||"{}");tokens[name.toLowerCase()]=token;localStorage.setItem(ownerTokensKey,JSON.stringify(tokens)); }
function persist() {
  if (state.date !== weekStart()) { state.date = weekStart(); state.players = []; draftSlots.clear(); availabilityDirty = false; }
  localStorage.setItem(storeKey, JSON.stringify(state));
}
function gameName() { return nameInput.value.trim().replace(/\s+/g," ").slice(0,16); }
function gameTag() { return tagInput.value.trim().replace(/[^a-zA-Z0-9]/g,"").slice(0,5); }
function cleanName() { return `${gameName()}#${gameTag()}`; }
function validRiotId() { return gameName().length>=3 && gameTag().length>=3; }
function validInviteCode() { return inviteCodeInput.value.trim().length>=4; }
function formatWeekDate(value) { const [y,m,d] = value.split("-").map(Number); return new Intl.DateTimeFormat("es-AR", { day:"numeric", month:"short" }).format(new Date(y,m-1,d)); }
function dayDate(index) { const date = new Date(`${weekStart()}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+index); return { year:date.getUTCFullYear(), month:date.getUTCMonth(), day:date.getUTCDate() }; }
function slotsForDay(index) {
  const date = dayDate(index);
  return Array.from({ length:24 }, (_,hour) => ({ id:new Date(date.year,date.month,date.day,hour).toISOString(), label:`${String(hour).padStart(2,"0")}:00` }));
}
function currentPlayer() { return state.players.find(player => player.name.toLowerCase() === currentName.toLowerCase()); }
function escapeHtml(text) { const element=document.createElement("span"); element.textContent=text; return element.innerHTML; }

noButton.addEventListener("click", () => {
  noClicks++; $("#taunt").textContent=taunts[(noClicks-1)%taunts.length];
  const zone=answerZone.getBoundingClientRect(), button=noButton.getBoundingClientRect();
  noButton.style.left=`${Math.random()*Math.max(0,zone.width-button.width)}px`;
  noButton.style.top=`${35+Math.random()*Math.max(0,zone.height-button.height-35)}px`;
  yesButton.style.transform=`scale(${Math.min(1+noClicks*.18,2.15)})`;
});
yesButton.addEventListener("click", async () => {
  const submittedGameName=gameName(), submittedTag=gameTag();
  currentName=cleanName();
  currentInviteCode=inviteCodeInput.value.trim();
  if(!validRiotId()||!validInviteCode()){$("#name-error").textContent="Ingresá tu Riot ID y el código de invitación.";(!validRiotId()?nameInput:inviteCodeInput).focus();return;}
  yesButton.disabled=true;$("#name-error").textContent="Verificando invitación…";
  try {
    const joined=await remoteStore.join(currentName,currentInviteCode,loadOwnerToken(currentName));
    currentOwnerToken=joined?.ownerToken||loadOwnerToken(currentName);
    if(joined?.ownerToken)saveOwnerToken(currentName,joined.ownerToken);
  } catch(error) {
    $("#name-error").textContent=error.status===409?"Ese invocador ya pertenece a otro dispositivo.":"Código inválido o demasiados intentos. Probá nuevamente.";
    validateRiotId();return;
  }
  localStorage.setItem(savedRiotIdKey,JSON.stringify({gameName:submittedGameName,tagLine:submittedTag}));
  saveLoginCookie(submittedGameName,submittedTag,currentInviteCode);
  sessionStorage.setItem("salelol-name",currentName);
  if(!currentPlayer()) state.players.push({name:currentName,slots:[],joinedAt:Date.now()});
  persist();inviteView.classList.add("hidden");lobbyView.classList.remove("hidden");render();
  const profileResult=await Promise.resolve(remoteStore.fetchRiotProfile(submittedGameName,submittedTag,currentInviteCode)).then(value=>({status:"fulfilled",value}),reason=>({status:"rejected",reason}));
  if(profileResult.status==="fulfilled"){
    applyProfile(currentPlayer(),profileResult.value);
    render();
    await pollForRiotProfile(currentName);
  }else{
    console.error("Riot profile unavailable; lobby access preserved",profileResult.reason);
    await refreshRemote().catch(console.error);
  }
  loadClashSchedule().catch(console.error);
});
function validateRiotId(){
  $("#name-error").textContent="";
  yesButton.disabled=!validRiotId()||!validInviteCode();
}
nameInput.addEventListener("input",validateRiotId);
tagInput.addEventListener("input",()=>{tagInput.value=gameTag();validateRiotId();});
inviteCodeInput.addEventListener("input",validateRiotId);
toggleInviteCode.addEventListener("click",()=>{const visible=inviteCodeInput.type==="text";inviteCodeInput.type=visible?"password":"text";toggleInviteCode.textContent=visible?"MOSTRAR":"OCULTAR";toggleInviteCode.setAttribute("aria-pressed",String(!visible));toggleInviteCode.setAttribute("aria-label",visible?"Mostrar código de invitación":"Ocultar código de invitación");inviteCodeInput.focus();});
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;installButton.classList.add("visible");});
window.addEventListener("appinstalled",()=>{installPrompt=null;installButton.classList.remove("visible");});
installButton.addEventListener("click",async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;installButton.classList.remove("visible");return;}const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);alert(ios?"En Safari, tocá Compartir y después ‘Agregar a pantalla de inicio’.":"Abrí el menú del navegador y elegí ‘Agregar a pantalla de inicio’ o ‘Instalar aplicación’.");});
$("#app-tabs").addEventListener("click",event=>{const button=event.target.closest("[data-tab]");if(!button)return;document.querySelectorAll(".app-tab").forEach(tab=>{const active=tab===button;tab.classList.toggle("active",active);tab.setAttribute("aria-selected",String(active));});document.querySelectorAll(".tab-panel").forEach(panel=>panel.classList.toggle("hidden",panel.id!==button.dataset.tab));});
$("#day-tabs").addEventListener("click",event=>{const button=event.target.closest("[data-day]");if(!button)return;selectedDay=Number(button.dataset.day);render();});
$("#time-slots").addEventListener("click",event=>{const slot=event.target.closest(".slot");if(!slot)return;if(!availabilityDirty)draftSlots=new Set(currentPlayer()?.slots||[]);draftSlots.has(slot.dataset.time)?draftSlots.delete(slot.dataset.time):draftSlots.add(slot.dataset.time);availabilityDirty=true;renderTimeGrid();});
$("#save-availability").addEventListener("click",async()=>{const player=currentPlayer();if(!player)return;if(!availabilityDirty)draftSlots=new Set(player.slots||[]);const previous=player.slots;player.slots=[...draftSlots];persist();render();try{await remoteStore.saveSlots(currentName,player.slots,currentOwnerToken);availabilityDirty=false;await refreshRemote();$("#save-message").textContent="Semana guardada. GG.";}catch(error){player.slots=previous;persist();render();$("#save-message").textContent="No se pudo guardar. Volvé a ingresar al lobby.";}setTimeout(()=>{$("#save-message").textContent="";},2200);});
function render(){
  const players=[...state.players].sort((a,b)=>a.joinedAt-b.joinedAt);
  $("#player-count").textContent=players.length;
  $("#players-list").innerHTML=players.length?players.map((player,index)=>renderPlayer(player,index)).join(""):`<div class="empty">Todavía no entró ningún manco.</div>`;
  renderDayTabs();renderTimeGrid();renderTodayMatches();renderWeekCalendar(players);renderMancoRanking(players);renderSharedGames();
}
function renderPlayer(player,index){
  const days=dayNames.filter((_,day)=>slotsForDay(day).some(slot=>player.slots.includes(slot.id)));
  const rank=(player.rankTier||"unranked").toLowerCase();
  const rankEmblem=player.rankTier?`<span class="rank-emblem" title="${escapeHtml(player.rankTier)}" aria-label="Rango ${escapeHtml(player.rankTier)}"><svg viewBox="0 0 32 36" aria-hidden="true"><path class="emblem-wings" d="M3 8.5 10.5 12 16 4l5.5 8L29 8.5l-3 15L16 32 6 23.5z"/><path class="emblem-core" d="m16 9 5 7-2 9-3 3-3-3-2-9z"/><path class="emblem-cut" d="m7 14 5 3m13-3-5 3"/></svg></span>`:"";
  const recent=Array.isArray(player.recentGames)?player.recentGames.slice(0,5):[];
  const games=Array.from({length:5},(_,game)=>`<i class="game-result ${recent[game]===true?"win":recent[game]===false?"loss":"pending"}"></i>`).join("");
  const icon=player.profileIconUrl?`<img src="${escapeHtml(player.profileIconUrl)}" alt="" />`:`<span>${escapeHtml(player.name[0].toUpperCase())}</span>`;
  return `<div class="player player-card rank-${rank}"><span class="player-color" style="--player-color:${colors[index%colors.length]}"></span><div class="profile-icon">${icon}</div><div class="player-details"><div class="player-name-line"><strong>${escapeHtml(player.name)}</strong>${rankEmblem}</div><div class="recent-games has-tooltip" tabindex="0" data-tooltip="Últimas cinco partidas: verde = victoria, rojo = derrota" aria-label="Últimas cinco partidas: verde significa victoria y rojo derrota">${games}</div><small>${days.length?days.join(" · "):"Todavía sin horarios"}</small></div></div>`;
}
function renderDayTabs(){$("#day-tabs").innerHTML=dayNames.map((name,index)=>{const date=dayDate(index);return `<button type="button" data-day="${index}" class="day-tab ${selectedDay===index?"active":""}"><span>${name.slice(0,3)}</span><strong>${date.day}</strong></button>`;}).join("");$("#selected-day-label").textContent=dayNames[selectedDay];}
function renderTimeGrid(){const selected=availabilityDirty?draftSlots:new Set(currentPlayer()?.slots||[]);$("#time-slots").innerHTML=slotsForDay(selectedDay).map(slot=>{const count=state.players.filter(player=>player.slots.includes(slot.id)).length;return `<button class="slot ${selected.has(slot.id)?"selected":""}" type="button" data-time="${slot.id}"><strong>${slot.label}</strong><small>${count} disponible${count===1?"":"s"}</small></button>`;}).join("");}
function renderTodayMatches(){const today=(new Date().getDay()+6)%7;const overlaps=slotsForDay(today).map(slot=>({...slot,players:state.players.filter(player=>player.slots.includes(slot.id))})).filter(item=>item.players.length>=2);$("#today-overlaps").innerHTML=overlaps.length?overlaps.map(item=>`<div class="overlap-item"><strong>${item.label}</strong><div><span>${item.players.length} invocadores</span><small>${item.players.map(player=>escapeHtml(player.name)).join(" · ")}</small></div></div>`).join(""):`<div class="empty">No hay coincidencias para hoy todavía.</div>`;}
function availabilitySegments(player,slots){
  const selected=slots.map(slot=>player.slots.includes(slot.id));
  const segments=[];
  let start=-1;
  selected.forEach((isSelected,index)=>{
    if(isSelected&&start<0)start=index;
    if(start>=0&&(!isSelected||index===selected.length-1)){
      const end=isSelected&&index===selected.length-1?index+1:index;
      segments.push({start,end});
      start=-1;
    }
  });
  return segments;
}
function renderWeekCalendar(players){
  $("#week-calendar").innerHTML=dayNames.map((name,day)=>{
    const slots=slotsForDay(day);
    const active=players.filter(player=>slots.some(slot=>player.slots.includes(slot.id)));
    const axis=slots.map((slot,index)=>`<span style="--column:${index+1}">${index%2===0||index===slots.length-1?slot.label.slice(0,2):""}</span>`).join("");
    const lanes=active.map(player=>{
      const color=colors[players.indexOf(player)%colors.length];
      const segments=availabilitySegments(player,slots).map(segment=>{
        const from=slots[segment.start].label;
        const toHour=Number(slots[segment.end-1].label.slice(0,2))+1;
        const to=`${String(toHour).padStart(2,"0")}:00`;
        return `<i style="--start:${segment.start+1};--end:${segment.end+1};--lane-color:${color}" title="${escapeHtml(player.name)}: ${from}–${to}"></i>`;
      }).join("");
      return `<div class="availability-lane" style="--lane-color:${color}"><strong title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</strong><div class="availability-track" aria-label="Disponibilidad de ${escapeHtml(player.name)}">${segments}</div></div>`;
    }).join("");
    return `<article class="week-day"><header><div><strong>${name}</strong><small>${dayDate(day).day}</small></div><span>${active.length} disponible${active.length===1?"":"s"}</span></header><div class="day-timeline"><div class="timeline-axis"><b>INVOCADOR</b><div>${axis}</div></div><div class="availability-lanes">${lanes||`<p>Sin horarios cargados.</p>`}</div></div></article>`;
  }).join("");
}
function renderMancoRanking(players){
  const ranked=players.map(player=>{const games=Array.isArray(player.recentGames)?player.recentGames.filter(result=>typeof result==="boolean").slice(0,5):[];return {player,losses:games.filter(result=>!result).length,wins:games.filter(Boolean).length,total:games.length};}).filter(item=>item.total).sort((a,b)=>b.losses-a.losses||a.wins-b.wins||a.player.name.localeCompare(b.player.name));
  $("#manco-ranking").innerHTML=ranked.length?ranked.map((item,index)=>{const avatar=item.player.profileIconUrl?`<img src="${escapeHtml(item.player.profileIconUrl)}" alt="" />`:`<span>${escapeHtml(item.player.name[0].toUpperCase())}</span>`;return `<div class="manco-row ${index===0?"is-manco":""}"><strong>${index+1}</strong><div class="manco-avatar">${avatar}</div><span>${escapeHtml(item.player.name)}</span><small>${item.losses} derrota${item.losses===1?"":"s"}</small></div>`;}).join(""):`<div class="empty">Todavía no hay partidas para coronar a ningún manco.</div>`;
}
function compactRiotId(value){return String(value||"Desconocido").split("#")[0];}
function gameMessage(game){
  const ours=(game.teams||[]).flatMap(team=>team.players||[]).filter(player=>player.isOurBoy);
  const won=ours.some(player=>player.win);
  if(!won){
    const worst=[...ours].sort((a,b)=>((a.kills+a.assists)/Math.max(1,a.deaths))-((b.kills+b.assists)/Math.max(1,b.deaths))||b.deaths-a.deaths)[0];
    return `Report ${compactRiotId(worst?.riotId)}`;
  }
  const best=[...ours].sort((a,b)=>((b.kills+b.assists)/Math.max(1,b.deaths))-((a.kills+a.assists)/Math.max(1,a.deaths)))[0];
  const options=["Siempre confié en este team","Aaahhhh IZI",`Carriados por ${compactRiotId(best?.riotId)}`];
  const seed=[...String(game.match_id||"")].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  return options[seed%options.length];
}
function renderMatchPlayer(player){
  const icon=player.championIconUrl?`<img src="${escapeHtml(player.championIconUrl)}" alt="${escapeHtml(player.championName||"")}" loading="lazy" />`:`<span>${escapeHtml((player.championName||"?")[0])}</span>`;
  return `<div class="match-player ${player.isOurBoy?"our-boy":""}"><div class="champion-icon">${icon}</div><div class="match-player-copy"><strong>${escapeHtml(compactRiotId(player.riotId))}</strong><small>${escapeHtml(player.championName||"Campeón")}</small></div><b>${Number(player.kills)||0}/${Number(player.deaths)||0}/${Number(player.assists)||0}</b></div>`;
}
function renderSharedGames(){
  const games=Array.isArray(state.sharedGames)?state.sharedGames:[];
  $("#shared-games").innerHTML=games.length?games.map(game=>{
    const teams=game.teams||[];
    const ours=teams.flatMap(team=>team.players||[]).filter(player=>player.isOurBoy);
    const won=ours.some(player=>player.win);
    const played=new Intl.DateTimeFormat("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(game.game_start));
    const duration=Math.max(1,Math.round((game.duration_seconds||0)/60));
    return `<article class="shared-game ${won?"win":"loss"}"><header><div><span class="game-outcome">${won?"VICTORIA":"DERROTA"}</span><h3>${escapeHtml(gameMessage(game))}</h3></div><small>${played} · ${duration} min · ${ours.length} de los nuestros</small></header><div class="match-teams">${teams.map(team=>`<section class="match-team ${team.win?"winning-team":""}"><div class="team-label"><span>${team.win?"Victoria":"Derrota"}</span><b>${team.kills||0} kills</b></div>${(team.players||[]).map(renderMatchPlayer).join("")}</section>`).join("")}</div></article>`;
  }).join(""):`<div class="empty">Todavía no encontramos partidas compartidas.</div>`;
}
async function loadClashSchedule(){
  if(!currentInviteCode)return;
  const notice=$("#clash-notice");
  const result=await remoteStore.fetchClashSchedule(currentInviteCode);
  const schedule=(result?.tournaments||[]).flatMap(tournament=>(tournament.schedule||[]).filter(item=>!item.cancelled).map(item=>({...item,name:tournament.name}))).filter(item=>item.startTime>Date.now()).sort((a,b)=>a.startTime-b.startTime)[0];
  if(!schedule){notice.classList.add("hidden");return;}
  const starts=new Intl.DateTimeFormat("es-AR",{weekday:"long",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Amsterdam"}).format(new Date(schedule.startTime));
  notice.innerHTML=`<span>⚔</span><div><strong>Próximo Clash${schedule.name?`: ${escapeHtml(schedule.name)}`:""}</strong><small>${escapeHtml(starts)} · horario de Ámsterdam</small></div>`;
  notice.classList.remove("hidden");
}
function applyProfile(player,profile){if(!player||!profile)return;player.profileIconUrl=profile.profileIconUrl;player.rankTier=profile.rankTier;player.rankDisplay=profile.rankDisplay;player.recentGames=profile.recentGames||[];player.recentMatchSummaries=profile.recentMatchSummaries||[];persist();}
async function pollForRiotProfile(name,maxAttempts=10){for(let attempt=0;attempt<maxAttempts;attempt++){await refreshRemote();const player=state.players.find(item=>item.name.toLowerCase()===name.toLowerCase());if(player&&(player.profileIconUrl||player.rankTier||(player.recentGames||[]).length))return true;await new Promise(resolve=>setTimeout(resolve,1200));}return false;}
async function refreshRemote(){const remote=await remoteStore.load();if(!remote)return;Object.assign(state,remote);localStorage.setItem(storeKey,JSON.stringify(state));render();}
window.addEventListener("storage",event=>{if(event.key===storeKey&&event.newValue){Object.assign(state,JSON.parse(event.newValue));render();}});
if(remoteStore.enabled){refreshRemote().catch(console.error);setInterval(()=>refreshRemote().catch(console.error),5000);}
validateRiotId();
if(savedCredentials&&validRiotId()&&validInviteCode())queueMicrotask(()=>yesButton.click());
if(matchMedia("(display-mode: standalone)").matches||navigator.standalone){installButton.classList.remove("visible");}else if(/android|iphone|ipad|ipod/i.test(navigator.userAgent)){installButton.classList.add("visible");}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));}
