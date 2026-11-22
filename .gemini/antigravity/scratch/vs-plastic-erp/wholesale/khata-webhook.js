const crypto=require("node:crypto");
function equal(left,right){
 const a=Buffer.from(String(left||"")),b=Buffer.from(String(right||""));
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function mount(app,express,db,env=process.env){
 const route="/integrations/khata/whatsapp";
 app.get(route,(req,res)=>{
  if(!env.WA_VERIFY_TOKEN||req.query["hub.mode"]!=="subscribe"||!equal(req.query["hub.verify_token"],env.WA_VERIFY_TOKEN))return res.sendStatus(403);
  res.type("text/plain").send(String(req.query["hub.challenge"]||""));
 });
 app.post(route,express.raw({type:"application/json",limit:"256kb"}),async(req,res,next)=>{
  try{
   if(!env.WA_APP_SECRET||!env.WA_PHONE_ID||!Buffer.isBuffer(req.body))return res.sendStatus(403);
   const expected="sha256="+crypto.createHmac("sha256",env.WA_APP_SECRET).update(req.body).digest("hex");
   if(!equal(expected,req.get("X-Hub-Signature-256")))return res.sendStatus(403);
   let payload;try{payload=JSON.parse(req.body)}catch{return res.sendStatus(400)}
   for(const entry of payload.entry||[])for(const change of entry.changes||[]){
    const value=change.value;if(value?.metadata?.phone_number_id!==env.WA_PHONE_ID)continue;
    for(const event of value.statuses||[]){
     if(!["sent","delivered","read","failed"].includes(event.status)||!event.id||!/^\d{1,16}$/.test(event.timestamp))continue;
     try{await db.run("INSERT INTO k_delivery_events(provider_id,status,event_time) VALUES(?,?,?)",[event.id,event.status,event.timestamp]);}
     catch(e){if(e.code!=="ER_DUP_ENTRY"&&!String(e.message).includes("UNIQUE constraint"))throw e;}
    }
    for(const message of value.messages||[]){
     if(!["stop","unsubscribe","બંધ","बंद"].includes(String(message.text?.body||"").trim().toLowerCase()))continue;
     if(!/^91[6-9]\d{9}$/.test(message.from))continue;
     await db.run("UPDATE k_policy SET consent=0 WHERE customer_id IN (SELECT u.id FROM w_users u LEFT JOIN k_profiles p ON p.customer_id=u.id WHERE COALESCE(NULLIF(p.whatsapp_phone,''),u.phone)=?)",[message.from.slice(2)]);
    }
   }
   res.sendStatus(200);
  }catch(e){next(e);}
 });
}
module.exports={mount};
