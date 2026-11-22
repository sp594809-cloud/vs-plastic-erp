// Run as a private scheduled process on the same service network.
const k=require("./khata");
function candidate(rows,interactions,day,stages){
  const latest=interactions.filter(x=>["dispute","resolved"].includes(x.kind)).at(-1);
  if(latest?.kind==="dispute")return null;
  const state=k.summary(rows,day);
  if(state.balance<=0)return null;
  return state.unpaid.map(entry=>({entry,stage:k.days(day,entry.due||entry.posted)}))
    .filter(x=>stages.includes(x.stage)).sort((a,b)=>b.stage-a.stage)[0]||null;
}
async function run(db,env=process.env,send=fetch){
  const names=["WA_GRAPH_VERSION","WA_PHONE_ID","WA_TOKEN","WA_APPROVED_TEMPLATE","WA_LANGUAGE"];
  if(names.some(n=>!env[n]))throw Error("Configure the approved WhatsApp template and server credentials.");
  if(!/^v\d+\.\d+$/.test(env.WA_GRAPH_VERSION)||!/^\d+$/.test(env.WA_PHONE_ID))throw Error("Invalid WhatsApp API configuration.");
  const stages=(env.KHATA_REMINDER_DAYS||"-3,0,3,7,14,30").split(",").map(Number);
  if(!stages.every(Number.isInteger))throw Error("Invalid reminder stages.");
  const customers=await db.all("SELECT customer_id FROM k_policy WHERE consent=1");
  for(const {customer_id:id} of customers){
    const job=await db.transaction(async tx=>{
      const c=await tx.one("SELECT business,phone FROM w_users WHERE id=?"+db.lock,[id]);
      const profile=await tx.one("SELECT language,whatsapp_phone FROM k_profiles WHERE customer_id=?",[id]);
      const p=await tx.one("SELECT consent FROM k_policy WHERE customer_id=?",[id]);
      if(!p?.consent)return;
      const rows=await k.loadEntries(tx,id);
      const contacts=await tx.all("SELECT kind FROM k_contacts WHERE customer_id=? ORDER BY id",[id]);
      const hit=candidate(rows,contacts,k.today(),stages);if(!hit)return;
      const {entry,stage}=hit, key=[id,entry.id,entry.due,stage].join("/");
      const prior=await tx.one("SELECT * FROM k_deliveries WHERE send_key=?",[key]);
      if(prior&&(prior.status!=="rate_limited"||prior.attempts>=3))return;
      const now=new Date().toISOString();
      if(prior)await tx.run("UPDATE k_deliveries SET status='sending',attempts=attempts+1,amount=?,updated_at=? WHERE send_key=?",[entry.left,now,key]);
      else await tx.run("INSERT INTO k_deliveries(send_key,customer_id,entry_id,stage,amount,status,attempts,updated_at) VALUES(?,?,?,?,?,'sending',1,?)",[key,id,entry.id,stage,entry.left,now]);
      return {key,to:"91"+(profile?.whatsapp_phone||c.phone),lang:profile?.language||env.WA_LANGUAGE,values:[c.business,(entry.left/100).toFixed(2),entry.due]};
    });
    if(!job)continue;
    let status="unknown", provider=null;
    try{
      const resp=await send("https://graph.facebook.com/"+env.WA_GRAPH_VERSION+"/"+env.WA_PHONE_ID+"/messages",{method:"POST",signal:AbortSignal.timeout(12000),headers:{Authorization:"Bearer "+env.WA_TOKEN,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:job.to,type:"template",template:{name:env.WA_APPROVED_TEMPLATE,language:{code:job.lang},components:[{type:"body",parameters:job.values.map(text=>({type:"text",text}))}]}})});
      if(resp.ok){provider=(await resp.json()).messages?.[0]?.id;status=provider?"accepted":"unknown";}
      else status=resp.status===429?"rate_limited":resp.status>=500?"unknown":"rejected";
    }catch{ /* Ambiguous provider outcome requires reconciliation before retry. */ }
    await db.run("UPDATE k_deliveries SET status=?,provider_id=?,updated_at=? WHERE send_key=?",[status,provider||null,new Date().toISOString(),job.key]);
  }
}
module.exports={candidate,run};
if(require.main===module){const db=require("./database");run(db).catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.close());}
