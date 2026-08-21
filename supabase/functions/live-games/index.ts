import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const adminClient=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CACHE_TTL_MS=75_000;

async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function validInvitation(code:unknown){const expected=Deno.env.get("LOBBY_INVITE_TOKEN")||"";return Boolean(expected&&typeof code==="string"&&await hash(code.trim())===await hash(expected));}
async function rateLimit(request:Request){const address=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";const identifier=await hash(`live-games:${address}`);const {data,error}=await adminClient().rpc("consume_api_rate_limit",{rate_scope:"live-games",rate_identifier:identifier,rate_limit:30,window_seconds:60});if(error)throw error;return Boolean(data);}
function currentWeekStart(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(Date.UTC(+value.year,+value.month-1,+value.day));const reset=date.getUTCDay()===0&&+value.hour===23&&+value.minute>=59;date.setUTCDate(date.getUTCDate()+(reset?1:-((date.getUTCDay()+6)%7)));return date.toISOString().slice(0,10);}

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const {invitationCode}=await request.json();
    if(!await rateLimit(request))return json({error:"Too many live-game checks"},429);
    if(!await validInvitation(invitationCode))return json({error:"Invalid invitation"},403);
    const riotKey=Deno.env.get("RIOT_API_KEY")?.trim();
    if(!riotKey)return json({error:"RIOT_API_KEY has not been configured"},500);

    const db=adminClient();
    const {data:cached}=await db.from("live_game_cache").select("players,checked_at").eq("id",1).maybeSingle();
    const cacheAge=cached?Date.now()-new Date(cached.checked_at).getTime():Infinity;
    if(cached&&cacheAge<CACHE_TTL_MS)return json({players:cached.players||[],checkedAt:cached.checked_at,cached:true});

    const {data:lobbyPlayers,error:playersError}=await db.from("players").select("name").eq("game_date",currentWeekStart());
    if(playersError)throw playersError;
    const wantedNames=new Set((lobbyPlayers||[]).map(player=>String(player.name).toLocaleLowerCase()));
    const {data:profiles,error:profilesError}=await db.from("riot_profiles").select("riot_id,puuid").not("puuid","is",null);
    if(profilesError)throw profilesError;
    const registered=(profiles||[]).filter(profile=>wantedNames.has(String(profile.riot_id).toLocaleLowerCase()));
    const byPuuid=new Map(registered.map(profile=>[String(profile.puuid),String(profile.riot_id)]));
    const checkedPuuids=new Set<string>();
    const active:Array<Record<string,unknown>>=[];

    for(const profile of registered){
      const puuid=String(profile.puuid);
      if(checkedPuuids.has(puuid))continue;
      const response=await fetch(`https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`,{headers:{"X-Riot-Token":riotKey}});
      if(response.status===404){checkedPuuids.add(puuid);continue;}
      if(!response.ok){
        if(cached&&cacheAge<10*60_000)return json({players:cached.players||[],checkedAt:cached.checked_at,cached:true,stale:true});
        return json({error:"Unable to check live games",riotStatus:response.status},response.status===429?429:502);
      }
      const game=await response.json();
      const participants=Array.isArray(game.participants)?game.participants:[];
      participants.forEach((participant:Record<string,unknown>)=>{const participantPuuid=String(participant.puuid||"");if(byPuuid.has(participantPuuid)){checkedPuuids.add(participantPuuid);active.push({riotId:byPuuid.get(participantPuuid),puuid:participantPuuid,championId:Number(participant.championId||0),gameId:String(game.gameId||""),gameStartTime:Number(game.gameStartTime||0),queueId:Number(game.gameQueueConfigId||0)});}});
    }

    let version="",champions=new Map<number,{name:string,image:string}>();
    if(active.length){
      try{
        const versions=await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
        version=String(versions[0]||"");
        const championData=await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/es_ES/champion.json`)).json();
        champions=new Map(Object.values(championData.data||{}).map((champion:any)=>[Number(champion.key),{name:String(champion.name),image:String(champion.image?.full||"")}]));
      }catch(error){console.error("Unable to enrich live champions",error);}
    }
    const players=active.map(item=>{const champion=champions.get(Number(item.championId));return {riotId:item.riotId,championName:champion?.name||`Campeón ${item.championId}`,championIconUrl:version&&champion?.image?`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${encodeURIComponent(champion.image)}`:null,gameId:item.gameId,gameStartTime:item.gameStartTime,queueId:item.queueId};});
    const checkedAt=new Date().toISOString();
    const {error:cacheError}=await db.from("live_game_cache").upsert({id:1,players,checked_at:checkedAt},{onConflict:"id"});
    if(cacheError)console.error("Unable to cache live games",cacheError);
    return json({players,checkedAt,cached:false});
  }catch(error){console.error(error);return json({error:"Live-game check failed"},500);}
});
