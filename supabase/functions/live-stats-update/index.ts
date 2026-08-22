import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const adminClient=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function validInvitation(code:unknown){const expected=Deno.env.get("LOBBY_INVITE_TOKEN")||"";return Boolean(expected&&typeof code==="string"&&await hash(code.trim())===await hash(expected));}
async function rateLimit(request:Request){const address=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";const identifier=await hash(`live-stats-update:${address}`);const {data,error}=await adminClient().rpc("consume_api_rate_limit",{rate_scope:"live-stats-update",rate_identifier:identifier,rate_limit:45,window_seconds:60});if(error)throw error;return Boolean(data);}
function currentWeekStart(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(Date.UTC(+value.year,+value.month-1,+value.day));const reset=date.getUTCDay()===0&&+value.hour===23&&+value.minute>=59;date.setUTCDate(date.getUTCDate()+(reset?1:-((date.getUTCDay()+6)%7)));return date.toISOString().slice(0,10);}
const integer=(value:unknown,min:number,max:number)=>Number.isInteger(value)&&Number(value)>=min&&Number(value)<=max;

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    if(!await rateLimit(request))return json({error:"Too many live-stat updates"},429);
    const {name,invitationCode,ownerToken,active,stats}=await request.json();
    if(!await validInvitation(invitationCode))return json({error:"Invalid invitation"},403);
    if(typeof name!=="string"||typeof ownerToken!=="string"||!ownerToken)return json({error:"Missing ownership"},401);
    const cleanName=name.trim();
    const db=adminClient();
    const {data:player,error:playerError}=await db.from("players").select("owner_token_hash,owner_token_hashes").eq("game_date",currentWeekStart()).eq("name",cleanName).maybeSingle();
    if(playerError)throw playerError;
    const tokenHash=await hash(ownerToken);
    if(!player||(player.owner_token_hash!==tokenHash&&!(player.owner_token_hashes||[]).includes(tokenHash)))return json({error:"Not your player"},403);
    if(active===false){const {error}=await db.from("desktop_live_stats").delete().eq("riot_id",cleanName).is("game_result",null);if(error)throw error;return json({ok:true,active:false});}
    if(!stats||typeof stats!=="object")return json({error:"Missing live stats"},400);
    const championName=String(stats.championName||"").trim();
    const gameMode=stats.gameMode==null?null:String(stats.gameMode).trim().slice(0,40);
    const gameResult=stats.gameResult==null?null:String(stats.gameResult).toLowerCase();
    if(gameResult!==null&&gameResult!=="win"&&gameResult!=="loss")return json({error:"Invalid game result"},400);
    if(!championName||championName.length>40||!integer(stats.kills,0,100)||!integer(stats.deaths,0,100)||!integer(stats.assists,0,200)||!integer(stats.creepScore,0,5000)||!Number.isFinite(stats.wardScore)||Number(stats.wardScore)<0||Number(stats.wardScore)>10000||!integer(stats.gameTimeSeconds,0,86400))return json({error:"Invalid live stats"},400);
    if(gameResult===null&&Number(stats.gameTimeSeconds)<45){const {error:clearError}=await db.from("post_game_reports").delete().neq("game_id","");if(clearError)console.error("Unable to clear previous report",clearError);}
    const {error}=await db.from("desktop_live_stats").upsert({riot_id:cleanName,champion_name:championName,kills:stats.kills,deaths:stats.deaths,assists:stats.assists,creep_score:stats.creepScore,ward_score:Number(stats.wardScore),game_time_seconds:stats.gameTimeSeconds,game_mode:gameMode,game_result:gameResult,updated_at:new Date().toISOString()},{onConflict:"riot_id"});
    if(error)throw error;
    return json({ok:true,active:true});
  }catch(error){console.error(error);return json({error:"Live-stat update failed"},500);}
});
