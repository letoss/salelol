import { adminClient, cors, currentWeekStart, hash, json, rateLimit, validInvitation } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error:"Method not allowed" }, 405);
  try {
    if (!await rateLimit(request, "lobby-join", 10, 60)) return json({ error:"Too many attempts" }, 429);
    const { name, invitationCode, ownerToken } = await request.json();
    if (!await validInvitation(invitationCode)) return json({ error:"Invalid invitation" }, 403);
    if (typeof name !== "string" || !/^.{3,16}#[a-zA-Z0-9]{3,5}$/.test(name.trim())) return json({ error:"Invalid Riot ID" }, 400);
    const db=adminClient(), week=currentWeekStart(), cleanName=name.trim();
    const { data:existing, error:readError }=await db.from("players").select("owner_token_hash").eq("game_date",week).eq("name",cleanName).maybeSingle();
    if(readError)throw readError;
    if(existing?.owner_token_hash){
      if(typeof ownerToken!=="string"||await hash(ownerToken)!==existing.owner_token_hash)return json({error:"Player already owned"},409);
      return json({ownerToken});
    }
    const token=crypto.randomUUID()+crypto.randomUUID();
    const tokenHash=await hash(token);
    if(existing){
      const {data,error}=await db.from("players").update({owner_token_hash:tokenHash,last_seen:new Date().toISOString()}).eq("game_date",week).eq("name",cleanName).is("owner_token_hash",null).select("name").maybeSingle();
      if(error)throw error;if(!data)return json({error:"Player ownership conflict"},409);
    }else{
      const {error}=await db.from("players").insert({game_date:week,name:cleanName,owner_token_hash:tokenHash});if(error)throw error;
    }
    return json({ownerToken:token});
  }catch(error){console.error(error);return json({error:"Join failed"},500);}
});
