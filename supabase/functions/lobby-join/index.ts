import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const adminClient=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function rateLimit(request:Request,scope:string,limit:number,windowSeconds:number){const address=request.headers.get("cf-connecting-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";const identifier=await hash(`${scope}:${address}`);const {data,error}=await adminClient().rpc("consume_api_rate_limit",{rate_scope:scope,rate_identifier:identifier,rate_limit:limit,window_seconds:windowSeconds});if(error)throw error;return Boolean(data);}
async function validInvitation(code:unknown){const expected=Deno.env.get("LOBBY_INVITE_TOKEN")||"";return Boolean(expected&&typeof code==="string"&&await hash(code.trim())===await hash(expected));}
function currentWeekStart(){const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(Date.UTC(+value.year,+value.month-1,+value.day));const reset=date.getUTCDay()===0&&+value.hour===23&&+value.minute>=59;date.setUTCDate(date.getUTCDate()+(reset?1:-((date.getUTCDay()+6)%7)));return date.toISOString().slice(0,10);}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error:"Method not allowed" }, 405);
  try {
    if (!await rateLimit(request, "lobby-join", 10, 60)) return json({ error:"Too many attempts" }, 429);
    const { name, invitationCode, ownerToken } = await request.json();
    if (!await validInvitation(invitationCode)) return json({ error:"Invalid invitation" }, 403);
    if (typeof name !== "string" || !/^.{3,16}#[a-zA-Z0-9]{3,5}$/.test(name.trim())) return json({ error:"Invalid Riot ID" }, 400);
    const db=adminClient(), week=currentWeekStart(), cleanName=name.trim();
    const { data:existing, error:readError }=await db.from("players").select("owner_token_hash,owner_token_hashes").eq("game_date",week).eq("name",cleanName).maybeSingle();
    if(readError)throw readError;
    if(existing&&typeof ownerToken==="string"&&ownerToken){
      const tokenHash=await hash(ownerToken);
      if(existing.owner_token_hash===tokenHash||(existing.owner_token_hashes||[]).includes(tokenHash))return json({ownerToken});
    }
    const token=crypto.randomUUID()+crypto.randomUUID();
    const tokenHash=await hash(token);
    if(existing){
      const hashes=[...new Set([...(existing.owner_token_hashes||[]),...(existing.owner_token_hash?[existing.owner_token_hash]:[]),tokenHash])].slice(-10);
      const {error}=await db.from("players").update({owner_token_hashes:hashes,last_seen:new Date().toISOString()}).eq("game_date",week).eq("name",cleanName);
      if(error)throw error;
    }else{
      const {error}=await db.from("players").insert({game_date:week,name:cleanName,owner_token_hashes:[tokenHash]});if(error)throw error;
    }
    return json({ownerToken:token});
  }catch(error){console.error(error);return json({error:"Join failed"},500);}
});
