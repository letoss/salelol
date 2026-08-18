import { remoteStore } from "./data-store.js";

const taunts = ["No seas trolaso", "Los mancos dicen No", "Alto manco", "No podes ser tan cagon", "Saleeee"];
const storeKey = "salelol-state-v1";
const state = loadState();
let currentName = sessionStorage.getItem("salelol-name") || "";
let noClicks = 0;
let draftSlots = new Set();
let availabilityDirty = false;

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
function today() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone:"Europe/Amsterdam", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
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
  if (!existing) state.players.push({ name:currentName, slots:[], lockedIn:false, joinedAt:Date.now() });
  persist();
  try { await remoteStore.join(currentName); await refreshRemote(); }
  catch (error) { showConnectionError(error); }
  inviteView.classList.add("hidden");
  lobbyView.classList.remove("hidden");
  render();
});
nameInput.addEventListener("input", () => { $("#name-error").textContent = ""; });

const [lobbyYear, lobbyMonth, lobbyDay] = today().split("-").map(Number);
const slotTimes = Array.from({ length:14 }, (_,i) => {
  const hour = i + 10;
  return {
    id:new Date(lobbyYear, lobbyMonth - 1, lobbyDay, hour).toISOString(),
    label:`${String(hour).padStart(2,"0")}:00`
  };
});
$("#time-slots").innerHTML = slotTimes.map(slot => `<button class="slot" type="button" data-time="${slot.id}"><strong>${slot.label}</strong><small>0 disponibles</small></button>`).join("");
$("#time-slots").addEventListener("click", (event) => {
  const slot = event.target.closest(".slot");
  if (!slot) return;
  if (!availabilityDirty) {
    const player = state.players.find(p => p.name.toLowerCase() === currentName.toLowerCase());
    draftSlots = new Set(player?.slots || []);
  }
  slot.classList.toggle("selected");
  slot.classList.contains("selected") ? draftSlots.add(slot.dataset.time) : draftSlots.delete(slot.dataset.time);
  availabilityDirty = true;
});

$("#save-availability").addEventListener("click", async () => {
  const player = state.players.find((p) => p.name.toLowerCase() === currentName.toLowerCase());
  if (!player) return;
  if (!availabilityDirty) draftSlots = new Set(player.slots || []);
  player.slots = [...draftSlots];
  persist(); render();
  try {
    await remoteStore.saveSlots(currentName, player.slots);
    availabilityDirty = false;
    await refreshRemote();
  } catch (error) { showConnectionError(error); }
  $("#save-message").textContent = "Horarios guardados. GG.";
  setTimeout(() => $("#save-message").textContent = "", 2200);
});

$("#lock-button").addEventListener("click", async () => {
  const player = state.players.find(p => p.name.toLowerCase() === currentName.toLowerCase());
  if (!player) return;
  player.lockedIn = !player.lockedIn;
  persist(); render();
  try { await remoteStore.setLocked(currentName, player.lockedIn); await refreshRemote(); }
  catch (error) { showConnectionError(error); }
});

function render() {
  const players = [...state.players].sort((a,b) => a.joinedAt-b.joinedAt);
  $("#player-count").textContent = players.filter(player => player.lockedIn).length;
  $("#players-list").innerHTML = players.length ? players.map(p => `<div class="player"><div class="lock-status ${p.lockedIn ? "is-locked" : ""}" title="${p.lockedIn ? "Confirmado" : "Sin confirmar"}" aria-label="${p.lockedIn ? "Confirmado" : "Sin confirmar"}">${p.lockedIn ? "✓" : "○"}</div><div><strong>${escapeHtml(p.name)}</strong><small>${p.slots.length ? p.slots.map(formatSlot).join(" · ") : "Todavía sin horario"}</small></div></div>`).join("") : `<div class="empty">Todavía no entró ningún manco.</div>`;
  document.querySelectorAll(".slot").forEach(el => {
    const count = players.filter(p => p.slots.includes(el.dataset.time)).length;
    el.querySelector("small").textContent = `${count} disponible${count===1?"":"s"}`;
    const me = players.find(p => p.name.toLowerCase()===currentName.toLowerCase());
    const selectedSlots = availabilityDirty ? draftSlots : new Set(me?.slots || []);
    el.classList.toggle("selected", selectedSlots.has(el.dataset.time));
  });
  const me = players.find(p => p.name.toLowerCase() === currentName.toLowerCase());
  const lockButton = $("#lock-button");
  lockButton.textContent = me?.lockedIn ? "DESBLOQUEAR" : "LOCK IN";
  lockButton.classList.toggle("is-locked", Boolean(me?.lockedIn));
  const overlaps = slotTimes.map(slot => ({ ...slot, players:players.filter(p => p.slots.includes(slot.id)) })).filter(item => item.players.length >= 2);
  $("#overlap-list").innerHTML = overlaps.length ? overlaps.map(item => `<div class="overlap-item"><strong>${item.label}</strong><div><span>${item.players.length} invocadores</span><small>${item.players.map(p => escapeHtml(p.name)).join(" · ")}</small></div></div>`).join("") : `<div class="empty">Todavía no hay horarios compartidos.</div>`;
}
function escapeHtml(text) { const el=document.createElement("span"); el.textContent=text; return el.innerHTML; }
function formatSlot(value) {
  if (!value.includes("T")) return escapeHtml(value);
  return new Intl.DateTimeFormat(undefined, { hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(value));
}
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
}
if (remoteStore.enabled) {
  refreshRemote().catch(showConnectionError);
  setInterval(() => refreshRemote().catch(showConnectionError), 5000);
}
