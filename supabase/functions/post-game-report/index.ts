import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const db=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
async function hash(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function invited(code:unknown){const expected=Deno.env.get("LOBBY_INVITE_TOKEN")||"";return Boolean(expected&&typeof code==="string"&&await hash(code.trim())===await hash(expected));}
const n=(value:unknown)=>Number(value)||0;
const round=(value:number,digits=1)=>Number(value.toFixed(digits));

function frameAt(frames:any[],participantId:number,minute:number){
  const target=minute*60_000;
  const frame=[...frames].reverse().find(item=>n(item.timestamp)<=target)||frames[0];
  return frame?.participantFrames?.[String(participantId)]||{};
}
function objectiveStats(events:any[],participantId:number,teamIds:Set<number>){
  const objectives=events.filter(event=>["ELITE_MONSTER_KILL","BUILDING_KILL"].includes(event.type)&&teamIds.has(n(event.killerId)));
  const joined=objectives.filter(event=>n(event.killerId)===participantId||(event.assistingParticipantIds||[]).map(n).includes(participantId)).length;
  return {joined,total:objectives.length,percent:objectives.length?round(joined/objectives.length*100,0):0};
}

Deno.serve(async request=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  try{
    const {name,invitationCode,ownerToken}=await request.json();
    if(!await invited(invitationCode))return json({error:"Invalid invitation"},403);
    if(typeof name!=="string"||typeof ownerToken!=="string")return json({error:"Missing ownership"},401);
    const store=db(),token=await hash(ownerToken);
    const {data:player}=await store.from("players").select("owner_token_hash,owner_token_hashes").ilike("name",name.trim()).order("game_date",{ascending:false}).limit(1).maybeSingle();
    if(!player||(player.owner_token_hash!==token&&!(player.owner_token_hashes||[]).includes(token)))return json({error:"Not your player"},403);
    const {data:profile}=await store.from("riot_profiles").select("puuid").ilike("riot_id",name.trim()).maybeSingle();
    if(!profile?.puuid)return json({error:"Riot profile missing"},409);
    const key=Deno.env.get("RIOT_API_KEY")?.trim();
    if(!key)return json({error:"RIOT_API_KEY missing"},500);
    const riot=async(url:string)=>{const response=await fetch(url,{headers:{"X-Riot-Token":key}});if(!response.ok)throw new Error(`Riot ${response.status}`);return response.json();};
    const ids=await riot(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(profile.puuid)}/ids?start=0&count=1`);
    const matchId=String(ids?.[0]||"");
    if(!matchId)return json({error:"Match not ready"},409);
    const [match,timeline]=await Promise.all([
      riot(`https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`),
      riot(`https://europe.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`),
    ]);
    const duration=Math.max(1,n(match.info?.gameDuration));
    if(Date.now()-n(match.info?.gameEndTimestamp)>20*60_000)return json({error:"Latest match is too old"},409);
    const {data:profiles}=await store.from("riot_profiles").select("riot_id,puuid");
    const registered=new Map((profiles||[]).map(item=>[String(item.puuid),String(item.riot_id)]));
    const participants=(match.info?.participants||[]).filter((item:any)=>registered.has(String(item.puuid)));
    const all=match.info?.participants||[],frames=timeline.info?.frames||[];
    const events=frames.flatMap((frame:any)=>frame.events||[]);
    const colors=["#0ac8b9","#e04f4f","#c89b3c","#8f7cec","#62c462","#ef8bc9"];
    const players=participants.map((p:any,index:number)=>{
      const id=n(p.participantId),teamIds=new Set<number>(all.filter((x:any)=>n(x.teamId)===n(p.teamId)).map((x:any)=>n(x.participantId)));
      const cs=n(p.totalMinionsKilled)+n(p.neutralMinionsKilled),at10=frameAt(frames,id,10),at15=frameAt(frames,id,15);
      const objective=objectiveStats(events,id,teamIds);
      const positions=frames.map((frame:any)=>frame.participantFrames?.[String(id)]?.position).filter((position:any)=>position&&Number.isFinite(position.x)&&Number.isFinite(position.y)).map((position:any)=>({x:n(position.x),y:n(position.y)}));
      const kp=(n(p.kills)+n(p.assists))/Math.max(1,all.filter((x:any)=>n(x.teamId)===n(p.teamId)).reduce((sum:number,x:any)=>sum+n(x.kills),0))*100;
      const roaming=round(Math.min(100,objective.percent*.55+Math.min(35,new Set(positions.map((point:any)=>`${Math.floor(point.x/3000)}:${Math.floor(point.y/3000)}`)).size*5)+Math.min(10,n(p.challenges?.takedownsFirstXMinutes))),0);
      const dead=n(p.totalTimeSpentDead),csMin=cs/(duration/60),visionMin=n(p.visionScore)/(duration/60),damageShare=n(p.challenges?.teamDamagePercentage)*100;
      const performance=round((n(p.kills)*2+n(p.assists))-(n(p.deaths)*2.2)-(dead/60*.35)+(csMin*.45)+(visionMin*2)+(objective.percent*.025)+(damageShare*.06),2);
      return {riotId:registered.get(String(p.puuid)),championName:p.championName,color:colors[index%colors.length],win:Boolean(p.win),kills:n(p.kills),deaths:n(p.deaths),assists:n(p.assists),csPerMinute:round(csMin),csAt10:n(at10.minionsKilled)+n(at10.jungleMinionsKilled),csAt15:n(at15.minionsKilled)+n(at15.jungleMinionsKilled),visionPerMinute:round(visionMin,2),timeDeadSeconds:dead,objectiveParticipation:objective,killParticipation:round(kp,0),damageShare:round(damageShare,1),roamingScore:roaming,positions,performance};
    });
    if(!players.length)return json({error:"Registered player missing from match"},409);
    const lowest=[...players].sort((a,b)=>a.performance-b.performance)[0];
    const gray=[...players].sort((a,b)=>b.timeDeadSeconds-a.timeDeadSeconds)[0];
    const afk=[...players].sort((a,b)=>(b.csPerMinute-b.killParticipation/18-b.objectiveParticipation.percent/25)-(a.csPerMinute-a.killParticipation/18-a.objectiveParticipation.percent/25))[0];
    const carry=[...players].sort((a,b)=>(b.damageShare+b.killParticipation*.35)-(a.damageShare+a.killParticipation*.35))[0];
    const group=players.length>1;
    const payload={matchId,gameStart:new Date(n(match.info?.gameStartTimestamp)).toISOString(),durationSeconds:duration,result:players[0]?.win?"win":"loss",players,awards:{manco:group?lowest?.riotId:null,gray:gray?.riotId,afkFarming:group?afk?.riotId:null,carry:group?carry?.riotId:null}};
    const {error}=await store.from("post_game_reports").upsert({game_id:matchId,payload,created_at:new Date().toISOString()},{onConflict:"game_id"});
    if(error)throw error;
    const {error:cleanupError}=await store.from("post_game_reports").delete().neq("game_id",matchId);
    if(cleanupError)console.error("Unable to remove older reports",cleanupError);
    return json({ok:true,report:payload});
  }catch(error){console.error(error);return json({error:"Post-game report is not ready yet"},409);}
});
