import { adminClient, cors, currentWeekStart, hash, json, rateLimit } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error:"Method not allowed" }, 405);
  try {
    if (!await rateLimit(request, "lobby-update", 60, 60)) return json({ error:"Too many updates" }, 429);
    const {name,ownerToken,slots,lockedIn}=await request.json();
    if(typeof name!=="string"||typeof ownerToken!=="string")return json({error:"Missing ownership"},401);
    const db=adminClient(),week=currentWeekStart();
    const {data:player,error}=await db.from("players").select("owner_token_hash").eq("game_date",week).eq("name",name.trim()).maybeSingle();
    if(error)throw error;if(!player?.owner_token_hash||await hash(ownerToken)!==player.owner_token_hash)return json({error:"Not your player"},403);
    const update:Record<string,unknown>={last_seen:new Date().toISOString()};
    if(slots!==undefined){if(!Array.isArray(slots)||slots.length>98||!slots.every((slot)=>typeof slot==="string"&&!Number.isNaN(Date.parse(slot))))return json({error:"Invalid slots"},400);update.slots=[...new Set(slots)];}
    if(lockedIn!==undefined){if(typeof lockedIn!=="boolean")return json({error:"Invalid lock state"},400);update.locked_in=lockedIn;}
    if(slots===undefined&&lockedIn===undefined)return json({error:"Nothing to update"},400);
    const {error:updateError}=await db.from("players").update(update).eq("game_date",week).eq("name",name.trim());if(updateError)throw updateError;
    return json({ok:true});
  }catch(error){console.error(error);return json({error:"Update failed"},500);}
});
