import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const adminClient=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function rateLimit(request:Request,scope:string,limit:number,windowSeconds:number){const address=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";const identifier=await hash(`${scope}:${address}`);const {data,error}=await adminClient().rpc("consume_api_rate_limit",{rate_scope:scope,rate_identifier:identifier,rate_limit:limit,window_seconds:windowSeconds});if(error)throw error;return Boolean(data);}
function currentWeekStart(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(Date.UTC(+value.year,+value.month-1,+value.day));const reset=date.getUTCDay()===0&&+value.hour===23&&+value.minute>=59;date.setUTCDate(date.getUTCDate()+(reset?1:-((date.getUTCDay()+6)%7)));return date.toISOString().slice(0,10);}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error:"Method not allowed" }, 405);
  try {
    if (!await rateLimit(request, "lobby-update", 60, 60)) return json({ error:"Too many updates" }, 429);
    const {name,ownerToken,slots,lockedIn}=await request.json();
    if(typeof name!=="string"||typeof ownerToken!=="string")return json({error:"Missing ownership"},401);
    const db=adminClient(),week=currentWeekStart();
    const {data:player,error}=await db.from("players").select("owner_token_hash,owner_token_hashes").eq("game_date",week).eq("name",name.trim()).maybeSingle();
    if(error)throw error;const tokenHash=await hash(ownerToken);if(!player||(player.owner_token_hash!==tokenHash&&!(player.owner_token_hashes||[]).includes(tokenHash)))return json({error:"Not your player"},403);
    const update:Record<string,unknown>={last_seen:new Date().toISOString()};
    if(slots!==undefined){if(!Array.isArray(slots)||slots.length>98||!slots.every((slot)=>typeof slot==="string"&&!Number.isNaN(Date.parse(slot))))return json({error:"Invalid slots"},400);update.slots=[...new Set(slots)];}
    if(lockedIn!==undefined){if(typeof lockedIn!=="boolean")return json({error:"Invalid lock state"},400);update.locked_in=lockedIn;}
    if(slots===undefined&&lockedIn===undefined)return json({error:"Nothing to update"},400);
    const {error:updateError}=await db.from("players").update(update).eq("game_date",week).eq("name",name.trim());if(updateError)throw updateError;
    return json({ok:true});
  }catch(error){console.error(error);return json({error:"Update failed"},500);}
});
