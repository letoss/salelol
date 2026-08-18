import { remoteStore } from "./data-store.js";

const taunts = ["No seas trolaso", "Los mancos dicen No", "Alto manco", "No podes ser tan cagon", "Saleeee"];
const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const colors = ["#0ac8b9", "#c89b3c", "#d979c7", "#65a9ff", "#ef6b62", "#8bd450", "#ad80ff", "#f29f4b"];
const storeKey = "salelol-state-v2";
const savedRiotIdKey = "salelol-riot-id";
const $ = selector => document.querySelector(selector);
const state = loadState();
let currentName = "";
let noClicks = 0;
let draftSlots = new Set();
let availabilityDirty = false;
let selectedDay = new Date().getDay();

const inviteView = $("#invite-view");
const lobbyView = $("#lobby-view");
const nameInput = $("#summoner-name");
const tagInput = $("#summoner-tag");
const yesButton = $("#yes-button");
const noButton = $("#no-button");
const answerZone = $("#answer-zone");
const installButton = $("#install-button");
const savedRiotId = loadSavedRiotId();
let installPrompt = null;
nameInput.value = savedRiotId.gameName;
tagInput.value = savedRiotId.tagLine;
$("#today-label").textContent = `Semana del ${formatWeekDate(weekStart())}`;

function amsterdamParts() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}
function weekStart() {
  const value = amsterdamParts();
  const date = new Date(Date.UTC(+value.year, +value.month - 1, +value.day));
  const reset = date.getUTCDay() === 6 && +value.hour === 23 && +value.minute >= 59;
  date.setUTCDate(date.getUTCDate() + (reset ? 1 : -date.getUTCDay()));
  return date.toISOString().slice(0, 10);
}
function loadState() { try { return JSON.parse(localStorage.getItem(storeKey)) || { date:weekStart(), players:[] }; } catch { return { date:weekStart(), players:[] }; } }
function loadSavedRiotId() { try { const value=JSON.parse(localStorage.getItem(savedRiotIdKey));return {gameName:value?.gameName||"",tagLine:value?.tagLine||""}; } catch { return {gameName:"",tagLine:""}; } }
function persist() {
  if (state.date !== weekStart()) { state.date = weekStart(); state.players = []; draftSlots.clear(); availabilityDirty = false; }
  localStorage.setItem(storeKey, JSON.stringify(state));
}
function gameName() { return nameInput.value.trim().replace(/\s+/g," ").slice(0,16); }
function gameTag() { return tagInput.value.trim().replace(/[^a-zA-Z0-9]/g,"").slice(0,5); }
function cleanName() { return `${gameName()}#${gameTag()}`; }
function validRiotId() { return gameName().length>=3 && gameTag().length>=3; }
function formatWeekDate(value) { const [y,m,d] = value.split("-").map(Number); return new Intl.DateTimeFormat("es-AR", { day:"numeric", month:"short" }).format(new Date(y,m-1,d)); }
function dayDate(index) { const date = new Date(`${weekStart()}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+index); return { year:date.getUTCFullYear(), month:date.getUTCMonth(), day:date.getUTCDate() }; }
function slotsForDay(index) {
  const date = dayDate(index);
  return Array.from({ length:14 }, (_,offset) => { const hour=offset+10; return { id:new Date(date.year,date.month,date.day,hour).toISOString(), label:`${String(hour).padStart(2,"0")}:00` }; });
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
  if(!validRiotId()){$("#name-error").textContent="Ingresá tu GameName y Tag completos.";nameInput.focus();return;}
  localStorage.setItem(savedRiotIdKey,JSON.stringify({gameName:submittedGameName,tagLine:submittedTag}));
  sessionStorage.setItem("salelol-name",currentName);
  if(!currentPlayer()) state.players.push({name:currentName,slots:[],lockedIn:false,joinedAt:Date.now()});
  persist();inviteView.classList.add("hidden");lobbyView.classList.remove("hidden");render();
  try{
    await remoteStore.join(currentName);
    const profile=await remoteStore.fetchRiotProfile(submittedGameName,submittedTag);
    applyProfile(currentPlayer(),profile);
    render();
    await pollForRiotProfile(currentName);
  }catch(error){console.error("Riot profile unavailable; lobby access preserved",error);await refreshRemote().catch(console.error);}
});
function validateRiotId(){
  $("#name-error").textContent="";
  yesButton.disabled=!validRiotId();
}
nameInput.addEventListener("input",validateRiotId);
tagInput.addEventListener("input",()=>{tagInput.value=gameTag();validateRiotId();});
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;installButton.classList.add("visible");});
window.addEventListener("appinstalled",()=>{installPrompt=null;installButton.classList.remove("visible");});
installButton.addEventListener("click",async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;installButton.classList.remove("visible");return;}const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);alert(ios?"En Safari, tocá Compartir y después ‘Agregar a pantalla de inicio’.":"Abrí el menú del navegador y elegí ‘Agregar a pantalla de inicio’ o ‘Instalar aplicación’.");});
$("#day-tabs").addEventListener("click",event=>{const button=event.target.closest("[data-day]");if(!button)return;selectedDay=Number(button.dataset.day);render();});
$("#time-slots").addEventListener("click",event=>{const slot=event.target.closest(".slot");if(!slot)return;if(!availabilityDirty)draftSlots=new Set(currentPlayer()?.slots||[]);draftSlots.has(slot.dataset.time)?draftSlots.delete(slot.dataset.time):draftSlots.add(slot.dataset.time);availabilityDirty=true;renderTimeGrid();});
$("#save-availability").addEventListener("click",async()=>{const player=currentPlayer();if(!player)return;if(!availabilityDirty)draftSlots=new Set(player.slots||[]);player.slots=[...draftSlots];persist();render();try{await remoteStore.saveSlots(currentName,player.slots);availabilityDirty=false;await refreshRemote();$("#save-message").textContent="Semana guardada. GG.";}catch(error){console.error(error);}setTimeout(()=>{$("#save-message").textContent="";},2200);});
$("#lock-button").addEventListener("click",async()=>{const player=currentPlayer();if(!player)return;player.lockedIn=!player.lockedIn;persist();render();try{await remoteStore.setLocked(currentName,player.lockedIn);await refreshRemote();}catch(error){console.error(error);}});

function render(){
  const players=[...state.players].sort((a,b)=>a.joinedAt-b.joinedAt);
  $("#player-count").textContent=players.filter(player=>player.lockedIn).length;
  $("#players-list").innerHTML=players.length?players.map((player,index)=>renderPlayer(player,index)).join(""):`<div class="empty">Todavía no entró ningún manco.</div>`;
  const me=currentPlayer();$("#lock-button").textContent=me?.lockedIn?"DESBLOQUEAR":"LOCK IN";$("#lock-button").classList.toggle("is-locked",Boolean(me?.lockedIn));
  renderDayTabs();renderTimeGrid();renderTodayMatches();renderWeekCalendar(players);renderMancoRanking(players);
}
function renderPlayer(player,index){
  const days=dayNames.filter((_,day)=>slotsForDay(day).some(slot=>player.slots.includes(slot.id)));
  const rank=(player.rankTier||"unranked").toLowerCase();
  const rankEmblem=player.rankTier?`<span class="rank-emblem" title="${escapeHtml(player.rankTier)}" aria-label="Rango ${escapeHtml(player.rankTier)}"><svg viewBox="0 0 32 36" aria-hidden="true"><path class="emblem-wings" d="M3 8.5 10.5 12 16 4l5.5 8L29 8.5l-3 15L16 32 6 23.5z"/><path class="emblem-core" d="m16 9 5 7-2 9-3 3-3-3-2-9z"/><path class="emblem-cut" d="m7 14 5 3m13-3-5 3"/></svg></span>`:"";
  const recent=Array.isArray(player.recentGames)?player.recentGames.slice(0,5):[];
  const games=Array.from({length:5},(_,game)=>`<i class="game-result ${recent[game]===true?"win":recent[game]===false?"loss":"pending"}"></i>`).join("");
  const icon=player.profileIconUrl?`<img src="${escapeHtml(player.profileIconUrl)}" alt="" />`:`<span>${escapeHtml(player.name[0].toUpperCase())}</span>`;
  return `<div class="player player-card rank-${rank}"><span class="player-color" style="--player-color:${colors[index%colors.length]}"></span><div class="profile-icon">${icon}</div><div class="player-details"><div class="player-name-line"><strong>${escapeHtml(player.name)}</strong>${rankEmblem}</div><div class="recent-games has-tooltip" tabindex="0" data-tooltip="Últimas cinco partidas: verde = victoria, rojo = derrota" aria-label="Últimas cinco partidas: verde significa victoria y rojo derrota">${games}</div><small>${days.length?days.join(" · "):"Todavía sin horarios"}</small></div><div class="lock-status ${player.lockedIn?"is-locked":""}">${player.lockedIn?"✓":"○"}</div></div>`;
}
function renderDayTabs(){$("#day-tabs").innerHTML=dayNames.map((name,index)=>{const date=dayDate(index);return `<button type="button" data-day="${index}" class="day-tab ${selectedDay===index?"active":""}"><span>${name.slice(0,3)}</span><strong>${date.day}</strong></button>`;}).join("");$("#selected-day-label").textContent=dayNames[selectedDay];}
function renderTimeGrid(){const selected=availabilityDirty?draftSlots:new Set(currentPlayer()?.slots||[]);$("#time-slots").innerHTML=slotsForDay(selectedDay).map(slot=>{const count=state.players.filter(player=>player.slots.includes(slot.id)).length;return `<button class="slot ${selected.has(slot.id)?"selected":""}" type="button" data-time="${slot.id}"><strong>${slot.label}</strong><small>${count} disponible${count===1?"":"s"}</small></button>`;}).join("");}
function renderTodayMatches(){const overlaps=slotsForDay(new Date().getDay()).map(slot=>({...slot,players:state.players.filter(player=>player.slots.includes(slot.id))})).filter(item=>item.players.length>=2);$("#today-overlaps").innerHTML=overlaps.length?overlaps.map(item=>`<div class="overlap-item"><strong>${item.label}</strong><div><span>${item.players.length} invocadores</span><small>${item.players.map(player=>escapeHtml(player.name)).join(" · ")}</small></div></div>`).join(""):`<div class="empty">No hay coincidencias para hoy todavía.</div>`;}
function renderWeekCalendar(players){$("#week-calendar").innerHTML=dayNames.map((name,day)=>{const slots=slotsForDay(day);const groups=slots.map(slot=>players.filter(player=>player.slots.includes(slot.id)));const active=players.filter(player=>groups.some(group=>group.includes(player)));const max=Math.max(0,...groups.map(group=>group.length));const peakNames=[...new Set(groups.filter(group=>group.length===max).flat().map(player=>player.name))];const dots=active.map(player=>`<i style="--dot:${colors[players.indexOf(player)%colors.length]}" title="${escapeHtml(player.name)}"></i>`).join("");const badge=max>=2?`<b class="has-tooltip" tabindex="0" data-tooltip="${escapeHtml(peakNames.join(" · "))}" aria-label="${max} jugadores coinciden: ${escapeHtml(peakNames.join(", "))}">×${max}</b>`:"";return `<div class="week-day"><div><strong>${name.slice(0,3)}</strong><small>${dayDate(day).day}</small></div><span class="calendar-dots">${dots||"—"}</span>${badge}</div>`;}).join("");}
function renderMancoRanking(players){
  const ranked=players.map(player=>{const games=Array.isArray(player.recentGames)?player.recentGames.filter(result=>typeof result==="boolean"):[];return {player,losses:games.filter(result=>!result).length,wins:games.filter(Boolean).length,total:games.length};}).filter(item=>item.total).sort((a,b)=>b.losses-a.losses||a.wins-b.wins||a.player.name.localeCompare(b.player.name));
  $("#manco-ranking").innerHTML=ranked.length?ranked.map((item,index)=>{const avatar=item.player.profileIconUrl?`<img src="${escapeHtml(item.player.profileIconUrl)}" alt="" />`:`<span>${escapeHtml(item.player.name[0].toUpperCase())}</span>`;return `<div class="manco-row ${index===0?"is-manco":""}"><strong>${index+1}</strong><div class="manco-avatar">${avatar}</div><span>${escapeHtml(item.player.name)}</span><small>${item.losses} derrota${item.losses===1?"":"s"}</small></div>`;}).join(""):`<div class="empty">Todavía no hay partidas para coronar a ningún manco.</div>`;
}
function applyProfile(player,profile){if(!player||!profile)return;player.profileIconUrl=profile.profileIconUrl;player.rankTier=profile.rankTier;player.rankDisplay=profile.rankDisplay;player.recentGames=profile.recentGames||[];persist();}
async function pollForRiotProfile(name,maxAttempts=10){for(let attempt=0;attempt<maxAttempts;attempt++){await refreshRemote();const player=state.players.find(item=>item.name.toLowerCase()===name.toLowerCase());if(player&&(player.profileIconUrl||player.rankTier||(player.recentGames||[]).length))return true;await new Promise(resolve=>setTimeout(resolve,1200));}return false;}
async function refreshRemote(){const remote=await remoteStore.load();if(!remote)return;Object.assign(state,remote);localStorage.setItem(storeKey,JSON.stringify(state));render();}
window.addEventListener("storage",event=>{if(event.key===storeKey&&event.newValue){Object.assign(state,JSON.parse(event.newValue));render();}});
if(remoteStore.enabled){refreshRemote().catch(console.error);setInterval(()=>refreshRemote().catch(console.error),5000);}
validateRiotId();
if(matchMedia("(display-mode: standalone)").matches||navigator.standalone){installButton.classList.remove("visible");}else if(/android|iphone|ipad|ipod/i.test(navigator.userAgent)){installButton.classList.add("visible");}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));}
