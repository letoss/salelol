import { remoteStore } from "./data-store.js";

const taunts = ["No seas trolaso", "Los mancos dicen No", "Alto manco", "No podes ser tan cagon", "Saleeee"];
const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const colors = ["#0ac8b9", "#c89b3c", "#d979c7", "#65a9ff", "#ef6b62", "#8bd450", "#ad80ff", "#f29f4b"];
const storeKey = "salelol-state-v2";
const $ = selector => document.querySelector(selector);
const state = loadState();
let currentName = sessionStorage.getItem("salelol-name") || "";
let noClicks = 0;
let draftSlots = new Set();
let availabilityDirty = false;
let selectedDay = new Date().getDay();

const inviteView = $("#invite-view");
const lobbyView = $("#lobby-view");
const nameInput = $("#summoner-name");
const yesButton = $("#yes-button");
const noButton = $("#no-button");
const answerZone = $("#answer-zone");
nameInput.value = currentName;
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
function persist() {
  if (state.date !== weekStart()) { state.date = weekStart(); state.players = []; draftSlots.clear(); availabilityDirty = false; }
  localStorage.setItem(storeKey, JSON.stringify(state));
}
function cleanName() { return nameInput.value.trim().replace(/\s+/g, " ").slice(0, 24); }
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
  currentName=cleanName();
  if(!currentName){$("#name-error").textContent="Primero decinos quién sos, manco.";nameInput.focus();return;}
  sessionStorage.setItem("salelol-name",currentName);
  if(!currentPlayer()) state.players.push({name:currentName,slots:[],lockedIn:false,joinedAt:Date.now()});
  persist(); try{await remoteStore.join(currentName);await refreshRemote();}catch(error){console.error(error);}
  inviteView.classList.add("hidden");lobbyView.classList.remove("hidden");render();
});
nameInput.addEventListener("input",()=>{$("#name-error").textContent="";});
$("#day-tabs").addEventListener("click",event=>{const button=event.target.closest("[data-day]");if(!button)return;selectedDay=Number(button.dataset.day);render();});
$("#time-slots").addEventListener("click",event=>{const slot=event.target.closest(".slot");if(!slot)return;if(!availabilityDirty)draftSlots=new Set(currentPlayer()?.slots||[]);draftSlots.has(slot.dataset.time)?draftSlots.delete(slot.dataset.time):draftSlots.add(slot.dataset.time);availabilityDirty=true;renderTimeGrid();});
$("#save-availability").addEventListener("click",async()=>{const player=currentPlayer();if(!player)return;if(!availabilityDirty)draftSlots=new Set(player.slots||[]);player.slots=[...draftSlots];persist();render();try{await remoteStore.saveSlots(currentName,player.slots);availabilityDirty=false;await refreshRemote();$("#save-message").textContent="Semana guardada. GG.";}catch(error){console.error(error);}setTimeout(()=>{$("#save-message").textContent="";},2200);});
$("#lock-button").addEventListener("click",async()=>{const player=currentPlayer();if(!player)return;player.lockedIn=!player.lockedIn;persist();render();try{await remoteStore.setLocked(currentName,player.lockedIn);await refreshRemote();}catch(error){console.error(error);}});

function render(){
  const players=[...state.players].sort((a,b)=>a.joinedAt-b.joinedAt);
  $("#player-count").textContent=players.filter(player=>player.lockedIn).length;
  $("#players-list").innerHTML=players.length?players.map((player,index)=>{const days=dayNames.filter((_,day)=>slotsForDay(day).some(slot=>player.slots.includes(slot.id)));return `<div class="player"><span class="player-color" style="--player-color:${colors[index%colors.length]}"></span><div class="lock-status ${player.lockedIn?"is-locked":""}">${player.lockedIn?"✓":"○"}</div><div><strong>${escapeHtml(player.name)}</strong><small>${days.length?days.join(" · "):"Todavía sin horarios"}</small></div></div>`;}).join(""):`<div class="empty">Todavía no entró ningún manco.</div>`;
  const me=currentPlayer();$("#lock-button").textContent=me?.lockedIn?"DESBLOQUEAR":"LOCK IN";$("#lock-button").classList.toggle("is-locked",Boolean(me?.lockedIn));
  renderDayTabs();renderTimeGrid();renderTodayMatches();renderWeekCalendar(players);
}
function renderDayTabs(){$("#day-tabs").innerHTML=dayNames.map((name,index)=>{const date=dayDate(index);return `<button type="button" data-day="${index}" class="day-tab ${selectedDay===index?"active":""}"><span>${name.slice(0,3)}</span><strong>${date.day}</strong></button>`;}).join("");$("#selected-day-label").textContent=dayNames[selectedDay];}
function renderTimeGrid(){const selected=availabilityDirty?draftSlots:new Set(currentPlayer()?.slots||[]);$("#time-slots").innerHTML=slotsForDay(selectedDay).map(slot=>{const count=state.players.filter(player=>player.slots.includes(slot.id)).length;return `<button class="slot ${selected.has(slot.id)?"selected":""}" type="button" data-time="${slot.id}"><strong>${slot.label}</strong><small>${count} disponible${count===1?"":"s"}</small></button>`;}).join("");}
function renderTodayMatches(){const overlaps=slotsForDay(new Date().getDay()).map(slot=>({...slot,players:state.players.filter(player=>player.slots.includes(slot.id))})).filter(item=>item.players.length>=2);$("#today-overlaps").innerHTML=overlaps.length?overlaps.map(item=>`<div class="overlap-item"><strong>${item.label}</strong><div><span>${item.players.length} invocadores</span><small>${item.players.map(player=>escapeHtml(player.name)).join(" · ")}</small></div></div>`).join(""):`<div class="empty">No hay coincidencias para hoy todavía.</div>`;}
function renderWeekCalendar(players){$("#week-calendar").innerHTML=dayNames.map((name,day)=>{const slots=slotsForDay(day);const active=players.filter(player=>slots.some(slot=>player.slots.includes(slot.id)));const max=Math.max(0,...slots.map(slot=>players.filter(player=>player.slots.includes(slot.id)).length));const dots=active.map(player=>`<i style="--dot:${colors[players.indexOf(player)%colors.length]}" title="${escapeHtml(player.name)}"></i>`).join("");return `<div class="week-day"><div><strong>${name.slice(0,3)}</strong><small>${dayDate(day).day}</small></div><span class="calendar-dots">${dots||"—"}</span>${max>=2?`<b>×${max}</b>`:""}</div>`;}).join("");}
async function refreshRemote(){const remote=await remoteStore.load();if(!remote)return;Object.assign(state,remote);localStorage.setItem(storeKey,JSON.stringify(state));render();}
window.addEventListener("storage",event=>{if(event.key===storeKey&&event.newValue){Object.assign(state,JSON.parse(event.newValue));render();}});
if(remoteStore.enabled){refreshRemote().catch(console.error);setInterval(()=>refreshRemote().catch(console.error),5000);}
