const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function validInvitation(code:unknown){const expected=Deno.env.get("LOBBY_INVITE_TOKEN")||"";return Boolean(expected&&typeof code==="string"&&await hash(code.trim())===await hash(expected));}

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const {invitationCode}=await request.json();
    if(!await validInvitation(invitationCode))return json({error:"Invalid invitation"},403);
    const riotKey=Deno.env.get("RIOT_API_KEY")?.trim();
    if(!riotKey)return json({error:"RIOT_API_KEY has not been configured"},500);
    const response=await fetch("https://euw1.api.riotgames.com/lol/clash/v1/tournaments",{headers:{"X-Riot-Token":riotKey}});
    if(!response.ok)return json({error:"Unable to load Clash schedule",riotStatus:response.status},response.status===429?429:502);
    const tournaments=await response.json();
    return json({tournaments:(tournaments||[]).map((tournament:Record<string,unknown>)=>({
      id:tournament.id,
      name:null,
      schedule:tournament.schedule||[],
    }))});
  }catch(error){console.error(error);return json({error:"Unable to load Clash schedule"},500);}
});
