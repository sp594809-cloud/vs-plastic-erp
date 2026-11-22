const k=require("./khata");
const base="/khata";
const staff=["admin","salesperson","manager","accountant"];
const signed=e=>["sale","refund"].includes(e.kind)?e.amount:-e.amount;
function ledger(rows){
  let balance=0;
  return [...rows].sort((a,b)=>a.posted.localeCompare(b.posted)||a.id-b.id).map(e=>{
    const delta=e.kind==="reversal"?-signed(rows.find(r=>r.id===e.original)):signed(e);
    balance+=delta;
    return {...e,delta,balance};
  });
}
function mount(app,db,wrap){
  app.use(base,(req,res,next)=>staff.includes(req.user?.role)?next():next(Object.assign(new Error("Staff sign-in required."),{status:403})));
  const scoped=user=>["manager","salesperson"].includes(user.role);
  async function customers(user){
    return db.all("SELECT u.id,u.business,u.phone,u.contact,u.city,u.business_type,u.status,u.address,u.gstin,u.created_at,h.area,h.secondary_phone,h.whatsapp_phone,h.language,h.notes AS khata_notes,p.limit_paise,p.terms,p.block_days,p.assigned,p.consent,f.manager_cap,f.yellow_days,f.orange_days,f.red_days FROM w_users u LEFT JOIN k_policy p ON p.customer_id=u.id LEFT JOIN k_preferences f ON f.customer_id=u.id LEFT JOIN k_profiles h ON h.customer_id=u.id WHERE u.role='customer'"+(scoped(user)?" AND p.assigned=?":"")+" ORDER BY u.business",scoped(user)?[user.id]:[]);
  }
  async function context(req){
    const c=(await customers(req.user)).find(c=>c.id===Number(req.params.id));
    if(!c)k.fail("Customer unavailable.",404);
    return c;
  }
  const back=(res,id,msg)=>res.redirect(303,base+"/"+id+"?notice="+encodeURIComponent(msg));
  app.get(base,wrap(async(req,res)=>{
    const list=await customers(req.user),ids=new Set(list.map(c=>c.id));
    const [entries,contacts]=await Promise.all(["k_entries","k_contacts"].map(table=>db.all("SELECT e.* FROM "+table+" e"+(scoped(req.user)?" JOIN k_policy p ON p.customer_id=e.customer_id WHERE p.assigned=?":"")+" ORDER BY e.id",scoped(req.user)?[req.user.id]:[])));
    const day=k.today(),since=day.slice(0,7),metrics={out:0,overdue:0,today:0,month:0,sales:0,due:0},aging=Array(7).fill(0);
    for(const c of list){
      const rows=entries.filter(e=>e.customer_id===c.id);Object.assign(c,k.summary(await k.loadEntries(db,c.id),day,c));
      const interactions=contacts.filter(e=>e.customer_id===c.id);
      c.next=interactions.at(-1);const promise=interactions.filter(e=>["promise","cancel","reschedule"].includes(e.kind)).at(-1);c.promise=promise?.kind==="promise"&&promise.follow_date<=day&&remaining(promise,rows,interactions)>0;
      metrics.out+=Math.max(0,c.balance);metrics.overdue+=c.overdue;
      metrics.due+=c.unpaid.filter(e=>e.due===day).reduce((s,e)=>s+e.left,0);
      c.aging.forEach((v,i)=>aging[i]+=v);
      for(const e of ledger(rows)){
        const type=e.kind==="reversal"?rows.find(r=>r.id===e.original).kind:e.kind;
        if(type==="payment"&&e.posted===day)metrics.today-=e.delta;
        if(e.posted.startsWith(since)){if(type==="payment")metrics.month-=e.delta;if(type==="sale")metrics.sales+=e.delta;}
      }
    }
    const calls=list.filter(c=>c.balance>0&&(c.promise||c.overdue||c.next?.follow_date===day)&&!(c.next?.kind==="reschedule"&&c.next.follow_date>day)).sort((a,b)=>Number(b.promise)-Number(a.promise)||b.maxDays-a.maxDays||b.overdue-a.overdue);
    const q=String(req.query.q||"").trim().toLowerCase();
    res.render("khata",{list:list.filter(c=>[c.business,c.phone,c.id,c.city,c.contact].join(" ").toLowerCase().includes(q)),count:ids.size,calls,metrics,aging,q,day,mode:req.query.view==="calls"?"calls":"overview"});
  }));
  function remaining(p,rows,interactions=[]){
    const next=interactions.filter(e=>e.id>p.id&&["promise","reschedule","cancel"].includes(e.kind)).sort((a,b)=>a.id-b.id)[0];
    const reversed=new Set(rows.filter(e=>e.kind==="reversal").map(e=>e.original));
    return Math.max(0,p.amount-rows.filter(e=>e.kind==="payment"&&!reversed.has(e.id)&&e.created_at>=p.created_at&&(!next||e.created_at<next.created_at)&&e.posted>=new Date(Date.parse(p.created_at)+19800000).toISOString().slice(0,10)).reduce((s,e)=>s+e.amount,0));
  }
  app.post(base+"/people/create",wrap(async(req,res)=>{
    if(req.user.role!=="admin")k.fail("Owner access required.",403);
    const b=req.body,role=b.role||"customer",name=String(b.business||"").trim(),phone=String(b.phone||"").replace(/[^0-9]/g,"").replace(/^91(?=[0-9]{10}$)/,"");
    const gst=String(b.gstin||"").trim().toUpperCase();
    if(!["customer","accountant","manager","salesperson"].includes(role)||!name||name.length>160||! /^[6-9][0-9]{9}$/.test(phone)||gst&&!/^[0-9A-Z]{15}$/.test(gst))k.fail("Check name, mobile and GST number.");
    const email=role==="customer"?k.key()+"@walkin.invalid":String(b.email||"").trim().toLowerCase();
    if(!/^[^@ ]+@[^@ ]+\.[^@ ]+$/.test(email))k.fail("Enter an employee email address.");
    const password=await require("./domain").hash(role==="customer"?k.key():b.password||"");
    const id=await db.transaction(async tx=>{
      if(await tx.one("SELECT id FROM w_users WHERE phone=? OR (gstin<>'' AND gstin=?) LIMIT 1",[phone,gst]))k.fail("Possible duplicate mobile or GST number. Open the existing account.");
      const result=await tx.run("INSERT INTO w_users(email,password,role,status,business,contact,phone,business_type,city,state,pincode,address,gstin,created_at) VALUES(?,?,?,'approved',?,?,?,?,?,'Gujarat',?,?,?,?)",[email,password,role,name,String(b.contact||name).slice(0,100),phone,String(b.category||"other").slice(0,60),String(b.city||"").slice(0,100),String(b.pin||"").slice(0,6),String(b.address||"").slice(0,1500),gst,new Date().toISOString()]);
      await tx.run("INSERT INTO w_audit(actor_id,event,created_at) VALUES(?,?,?)",[req.user.id,"Created "+role+" #"+result.id,new Date().toISOString()]);
      return result.id;
    });
    res.redirect(303,role==="customer"?base+"/"+id:base+"?notice=Employee+created+with+ID+"+id);
  }));
  app.get(base+"/:id/receipt/:entry",wrap(async(req,res)=>{
    const c=await context(req),e=await db.one("SELECT * FROM k_entries WHERE id=? AND customer_id=? AND kind='payment'",[Number(req.params.entry),c.id]);
    if(!e)k.fail("Receipt unavailable.",404);
    const voided=await db.one("SELECT id FROM k_entries WHERE original=?",[e.id]);
    res.render("khata-receipt",{c,e,voided});
  }));
  app.get(base+"/:id",wrap(async(req,res)=>{
    const c=await context(req), rows=await k.loadEntries(db,c.id);
    const all=ledger(rows),filtered=all.filter(e=>(!req.query.from||e.posted>=req.query.from)&&(!req.query.to||e.posted<=req.query.to)&&(!req.query.kind||e.kind===req.query.kind));
    if(req.query.csv==="1"||req.query.excel==="1"){
      const data=[["ID","Date","Type","Change (INR)","Balance (INR)","Note"],...filtered.map(e=>[e.id,e.posted,e.kind,e.delta/100,e.balance/100,e.note])];
      return require("./khata-reports").exportRows(res,req.query.excel==="1"?"excel":"csv","khata-statement",data);
    }
    const contacts=await db.all("SELECT * FROM k_contacts WHERE customer_id=? ORDER BY id DESC",[c.id]);
    const requests=await db.all("SELECT * FROM k_requests WHERE customer_id=? ORDER BY id DESC",[c.id]);
    const products=await db.all("SELECT id,name,sku FROM w_products WHERE active=1 ORDER BY name");
    const deliveries=await db.all("SELECT d.*, (SELECT e.status FROM k_delivery_events e WHERE e.provider_id=d.provider_id ORDER BY e.event_time DESC,e.status DESC LIMIT 1) AS provider_status FROM k_deliveries d WHERE d.customer_id=? ORDER BY d.updated_at DESC",[c.id]);
    res.render("khata-customer",{products,deliveries,c,rows:filtered,state:k.summary(rows,undefined,c),contacts,requests,remaining:p=>remaining(p,rows,contacts),key:k.key,day:k.today(),due:k.later(k.today(),c.terms??14),query:req.query});
  }));
  app.post(base+"/:id/entry",wrap(async(req,res)=>back(res,Number(req.params.id),await k.post(db,req.user,Number(req.params.id),req.body))));
  app.post(base+"/:id/extend",wrap(async(req,res)=>{
    const c=await context(req),b=req.body;
    if(!["admin","manager"].includes(req.user.role)||!b.reason?.trim())k.fail("Manager approval and reason required.",403);
    await db.transaction(async tx=>{
      await tx.one("SELECT id FROM w_users WHERE id=?"+db.lock,[c.id]);
      const entry=k.summary(await k.loadEntries(tx,c.id)).unpaid.find(e=>e.id===Number(b.sale)&&e.kind==="sale");
      const due=k.date(b.due);if(!entry||due<=entry.due)k.fail("Select an open sale and a later due date.");
      await tx.run("INSERT INTO k_extensions(sale_id,actor,due,reason,created_at) VALUES(?,?,?,?,?)",[entry.id,req.user.id,due,b.reason.slice(0,500),new Date().toISOString()]);
    });back(res,c.id,"Due date extended");
  }));
  app.post(base+"/:id/contact",wrap(async(req,res)=>{
    const c=await context(req),b=req.body,kind=b.kind;
    if(!["promise","attempt","reschedule","dispute","resolved","cancel"].includes(kind))k.fail("Invalid outcome.");
    const due=["promise","reschedule"].includes(kind)?k.date(b.date):null;
    if(due&&due<k.today())k.fail("Choose today or later.");
    if(!String(b.note||"").trim())k.fail("Record a short note.");
    await db.run("INSERT INTO k_contacts(customer_id,actor,kind,amount,follow_date,note,created_at) VALUES(?,?,?,?,?,?,?)",[c.id,req.user.id,kind,kind==="promise"?k.amount(b.amount):0,due,b.note.slice(0,500),new Date().toISOString()]);
    back(res,c.id,"Outcome recorded");
  }));
  app.post(base+"/:id/review",wrap(async(req,res)=>{
    const c=await context(req),b=req.body;
    if(!["admin","manager"].includes(req.user.role)||!["approved","rejected"].includes(b.status)||!b.reason?.trim())k.fail("Owner review and reason required.",403);
    await db.transaction(async tx=>{
      await tx.one("SELECT id FROM w_users WHERE id=?"+db.lock,[c.id]);
      const r=await tx.one("SELECT * FROM k_requests WHERE id=? AND customer_id=?"+db.lock,[Number(b.request),c.id]);
      if(!r||r.status!=="pending")k.fail("Request already reviewed or unavailable.");
      if(req.user.role==="manager"&&(r.actor===req.user.id||r.amount>(c.manager_cap||0)))k.fail("Owner review required.",403);
      const now=new Date().toISOString();
      if(b.status==="approved"){
        if(c.status!=="approved")k.fail("Customer is not approved.");
        await k.dispatchItems(tx,db.lock,r.request_key,req.user.id);
        await tx.run("INSERT INTO k_entries(customer_id,actor,kind,amount,posted,due,request_key,note,created_at) VALUES(?,?,'sale',?,?,?,?,?,?)",[c.id,req.user.id,r.amount,k.today(),r.due,r.request_key,r.note,now]);
      }
      await tx.run("UPDATE k_requests SET status=?,reason=?,reviewer=?,reviewed_at=? WHERE id=?",[b.status,b.reason.slice(0,500),req.user.id,now,r.id]);
    });
    back(res,c.id,"Review recorded");
  }));
  app.post(base+"/:id/profile",wrap(async(req,res)=>{
    const c=await context(req),b=req.body;
    if(req.user.role!=="admin")k.fail("Owner access required.",403);
    const mobile=input=>{const n=String(input||"").replace(/[^0-9]/g,"").replace(/^91(?=[0-9]{10}$)/,"");if(n&&!/^[6-9][0-9]{9}$/.test(n))k.fail("Enter a valid mobile number.");return n;};
    const secondary=mobile(b.secondary),wa=mobile(b.whatsapp),language=b.language;
    if(!["gu","hi","en"].includes(language))k.fail("Unsupported language.");
    await db.transaction(async tx=>{
      await tx.one("SELECT id FROM w_users WHERE id=?"+db.lock,[c.id]);
      await tx.run("DELETE FROM k_profiles WHERE customer_id=?",[c.id]);
      await tx.run("INSERT INTO k_profiles(customer_id,area,secondary_phone,whatsapp_phone,language,notes) VALUES(?,?,?,?,?,?)",[c.id,String(b.area||"").slice(0,100),secondary,wa,language,String(b.notes||"").slice(0,500)]);
      if((c.whatsapp_phone||c.phone)!==(wa||c.phone))await tx.run("UPDATE k_policy SET consent=0 WHERE customer_id=?",[c.id]);
      await tx.run("INSERT INTO w_audit(actor_id,event,created_at) VALUES(?,?,?)",[req.user.id,"Updated Khata contact profile #"+c.id,new Date().toISOString()]);
    });back(res,c.id,"Profile updated");
  }));
  app.post(base+"/:id/policy",wrap(async(req,res)=>{
    const c=await context(req),b=req.body;
    if(req.user.role!=="admin")k.fail("Owner access required.",403);
    const limit=k.amount(b.limit,true),terms=Number(b.terms),block=Number(b.block),assigned=Number(b.assigned)||null;
    if(![terms,block].every(n=>Number.isInteger(n)&&n>=0&&n<=365))k.fail("Enter days from 0 to 365.");
    await db.transaction(async tx=>{
      await tx.one("SELECT id FROM w_users WHERE id=?"+db.lock,[c.id]);
      if(assigned&&!await tx.one("SELECT id FROM w_users WHERE id=? AND role IN ('salesperson','manager')",[assigned]))k.fail("Unknown staff ID.");
      const cap=k.amount(b.manager_cap||"0",true),thresholds=[b.yellow||1,b.orange||15,b.red||31].map(Number);
      if(!thresholds.every((n,i)=>Number.isInteger(n)&&n>0&&n<=365&&(!i||n>thresholds[i-1])))k.fail("Risk thresholds must increase from yellow to red.");
      await tx.run("DELETE FROM k_preferences WHERE customer_id=?",[c.id]);
      await tx.run("INSERT INTO k_preferences(customer_id,manager_cap,yellow_days,orange_days,red_days) VALUES(?,?,?,?,?)",[c.id,cap,...thresholds]);
      await tx.run("DELETE FROM k_policy WHERE customer_id=?",[c.id]);
      await tx.run("INSERT INTO k_policy(customer_id,limit_paise,terms,block_days,assigned,consent) VALUES(?,?,?,?,?,?)",[c.id,limit,terms,block,assigned,b.consent==="yes"?1:0]);
      await tx.run("INSERT INTO w_audit(actor_id,event,created_at) VALUES(?,?,?)",[req.user.id,JSON.stringify({customer:c.id,cap,thresholds,limit,terms,block,assigned,consent:b.consent==="yes"}),new Date().toISOString()]);
    });back(res,c.id,"Policy updated");
  }));
}
module.exports={mount,ledger};
