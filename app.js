import { remoteStore } from "./data-store.js";

const taunts = ["No seas trolaso", "Los mancos dicen No", "Alto manco", "No podes ser tan cagon", "Saleeee"];
const storeKey = "salelol-state-v1";
const state = loadState();
let currentName = sessionStorage.getItem("salelol-name") || "";
let noClicks = 0;

const $ = (selector) => document.querySelector(selector);
const inviteView = $("#invite-view");
const lobbyView = $("#lobby-view");
const nameInput = $("#summoner-name");
const yesButton = $("#yes-button");
const noButton = $("#no-button");
const answerZone = $("#answer-zone");

nameInput.value = currentName;
$("#today-label").textContent = new Intl.DateTimeFormat("es-AR", { weekday:"long", day:"numeric", month:"long" }).format(new Date());

function loadState() {
  try { return JSON.parse(localStorage.getItem(storeKey)) || { date: today(), players: [], matches: [] }; }
  catch { return { date: today(), players: [], matches: [] }; }
}
function today() { return new Date().toISOString().slice(0,10); }
function persist() {
  if (state.date !== today()) { state.date = today(); state.players = []; state.matches = []; }
  localStorage.setItem(storeKey, JSON.stringify(state));
  window.dispatchEvent(new StorageEvent("storage", { key:storeKey, newValue:JSON.stringify(state) }));
}
function cleanName() { return nameInput.value.trim().replace(/\s+/g," ").slice(0,24); }

noButton.addEventListener("click", () => {
  noClicks += 1;
  $("#taunt").textContent = taunts[(noClicks - 1) % taunts.length];
  const zone = answerZone.getBoundingClientRect();
  const button = noButton.getBoundingClientRect();
  const maxX = Math.max(0, zone.width - button.width);
  const maxY = Math.max(35, zone.height - button.height);
  noButton.style.left = `${Math.random() * maxX}px`;
  noButton.style.top = `${35 + Math.random() * Math.max(0,maxY - 35)}px`;
  const scale = Math.min(1 + noClicks * .18, 2.15);
  yesButton.style.transform = `scale(${scale})`;
});

yesButton.addEventListener("click", async () => {
  currentName = cleanName();
  if (!currentName) { $("#name-error").textContent = "Primero decinos quién sos, manco."; nameInput.focus(); return; }
  sessionStorage.setItem("salelol-name", currentName);
  const existing = state.players.find((p) => p.name.toLowerCase() === currentName.toLowerCase());
  if (!existing) state.players.push({ name:currentName, slots:[], joinedAt:Date.now() });
  persist();
  try { await remoteStore.join(currentName); await refreshRemote(); }
  catch (error) { showConnectionError(error); }
  inviteView.classList.add("hidden");
  lobbyView.classList.remove("hidden");
  render();
});
nameInput.addEventListener("input", () => { $("#name-error").textContent = ""; });

const slotTimes = Array.from({ length:12 }, (_,i) => `${String(i+15).padStart(2,"0")}:00`);
$("#time-slots").innerHTML = slotTimes.map(t => `<button class="slot" type="button" data-time="${t}"><strong>${t}</strong><small>0 disponibles</small></button>`).join("");
$("#time-slots").addEventListener("click", (event) => event.target.closest(".slot")?.classList.toggle("selected"));

$("#save-availability").addEventListener("click", async () => {
  const player = state.players.find((p) => p.name.toLowerCase() === currentName.toLowerCase());
  if (!player) return;
  player.slots = [...document.querySelectorAll(".slot.selected")].map((el) => el.dataset.time);
  persist(); render();
  try { await remoteStore.saveSlots(currentName, player.slots); await refreshRemote(); }
  catch (error) { showConnectionError(error); }
  $("#save-message").textContent = "Horarios guardados. GG.";
  setTimeout(() => $("#save-message").textContent = "", 2200);
});

$("#match-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const time = $("#match-time").value;
  if (!time) return;
  const match = { id:crypto.randomUUID(), time, creator:currentName, createdAt:Date.now() };
  state.matches.unshift(match);
  persist(); render(); event.target.reset();
  try { await remoteStore.addMatch(match); await refreshRemote(); }
  catch (error) { showConnectionError(error); }
});

function render() {
  const players = [...state.players].sort((a,b) => a.joinedAt-b.joinedAt);
  $("#player-count").textContent = players.length;
  $("#players-list").innerHTML = players.length ? players.map(p => `<div class="player"><div class="avatar">${escapeHtml(p.name[0].toUpperCase())}</div><div><strong>${escapeHtml(p.name)}</strong><small>${p.slots.length ? p.slots.join(" · ") : "Todavía sin horario"}</small></div></div>`).join("") : `<div class="empty">Todavía no entró ningún manco.</div>`;
  document.querySelectorAll(".slot").forEach(el => {
    const count = players.filter(p => p.slots.includes(el.dataset.time)).length;
    el.querySelector("small").textContent = `${count} disponible${count===1?"":"s"}`;
    const me = players.find(p => p.name.toLowerCase()===currentName.toLowerCase());
    el.classList.toggle("selected", Boolean(me?.slots.includes(el.dataset.time)));
  });
  $("#match-list").innerHTML = state.matches.length ? state.matches.map(m => `<div class="match-item"><strong>${escapeHtml(m.time)} hs</strong><span>propuesta por ${escapeHtml(m.creator)}</span></div>`).join("") : `<div class="empty">No hay partidas propuestas todavía.</div>`;
}
function escapeHtml(text) { const el=document.createElement("span"); el.textContent=text; return el.innerHTML; }
window.addEventListener("storage", (event) => { if(event.key===storeKey && event.newValue) { Object.assign(state,JSON.parse(event.newValue)); render(); } });

async function refreshRemote() {
  const remote = await remoteStore.load();
  if (!remote) return;
  Object.assign(state, remote);
  localStorage.setItem(storeKey, JSON.stringify(state));
  render();
}
function showConnectionError(error) {
  console.error(error);
  $("#save-message").textContent = "No se pudo sincronizar. Revisá la configuración de Supabase.";
}
if (remoteStore.enabled) {
  refreshRemote().catch(showConnectionError);
  setInterval(() => refreshRemote().catch(showConnectionError), 5000);
}
