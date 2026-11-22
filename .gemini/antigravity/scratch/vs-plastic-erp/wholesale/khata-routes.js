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
    return db.all("SELECT u.id,u.business,u.phone,u.contact,u.city,u.business_type,u.status,p.limit_paise,p.terms,p.block_days,p.assigned,p.consent FROM w_users u LEFT JOIN k_policy p ON p.customer_id=u.id WHERE u.role='customer'"+(scoped(user)?" AND p.assigned=?":"")+" ORDER BY u.business",scoped(user)?[user.id]:[]);
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
      const rows=entries.filter(e=>e.customer_id===c.id);Object.assign(c,k.summary(rows));
      const interactions=contacts.filter(e=>e.customer_id===c.id);
      c.next=interactions.at(-1);c.promise=c.next?.kind==="promise"&&c.next.follow_date<=day&&remaining(c.next,rows)>0;
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
  function remaining(p,rows){
    const reversed=new Set(rows.filter(e=>e.kind==="reversal").map(e=>e.original));
    return Math.max(0,p.amount-rows.filter(e=>e.kind==="payment"&&!reversed.has(e.id)&&e.created_at>p.created_at&&e.posted>=p.created_at.slice(0,10)).reduce((s,e)=>s+e.amount,0));
  }
  app.get(base+"/:id",wrap(async(req,res)=>{
    const c=await context(req), rows=await db.all("SELECT * FROM k_entries WHERE customer_id=? ORDER BY id",[c.id]);
    const all=ledger(rows),filtered=all.filter(e=>(!req.query.from||e.posted>=req.query.from)&&(!req.query.to||e.posted<=req.query.to)&&(!req.query.kind||e.kind===req.query.kind));
    if(req.query.csv==="1"){
      const safe=v=>'"'+String(v??"").replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
      const data=[["ID","Date","Type","Debit paise (+) / Credit paise (-)","Balance paise","Note"],...filtered.map(e=>[e.id,e.posted,e.kind,e.delta,e.balance,e.note])];
      return res.attachment("khata-statement.csv").send("\ufeff"+data.map(row=>row.map(safe).join(",")).join("\r\n"));
    }
    const contacts=await db.all("SELECT * FROM k_contacts WHERE customer_id=? ORDER BY id DESC",[c.id]);
    const requests=await db.all("SELECT * FROM k_requests WHERE customer_id=? ORDER BY id DESC",[c.id]);
    res.render("khata-customer",{c,rows:filtered,state:k.summary(rows),contacts,requests,remaining:p=>remaining(p,rows),key:k.key,day:k.today(),due:k.later(k.today(),c.terms??14),query:req.query});
  }));
  app.post(base+"/:id/entry",wrap(async(req,res)=>back(res,Number(req.params.id),await k.post(db,req.user,Number(req.params.id),req.body))));
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
    if(req.user.role!=="admin"||!["approved","rejected"].includes(b.status)||!b.reason?.trim())k.fail("Owner review and reason required.",403);
    await db.transaction(async tx=>{
      await tx.one("SELECT id FROM w_users WHERE id=?"+db.lock,[c.id]);
      const r=await tx.one("SELECT * FROM k_requests WHERE id=? AND customer_id=?"+db.lock,[Number(b.request),c.id]);
      if(!r||r.status!=="pending")k.fail("Request already reviewed or unavailable.");
      const now=new Date().toISOString();
      if(b.status==="approved"){
        if(c.status!=="approved")k.fail("Customer is not approved.");
        await tx.run("INSERT INTO k_entries(customer_id,actor,kind,amount,posted,due,request_key,note,created_at) VALUES(?,?,'sale',?,?,?,?,?,?)",[c.id,req.user.id,r.amount,k.today(),r.due,r.request_key,r.note,now]);
      }
      await tx.run("UPDATE k_requests SET status=?,reason=?,reviewer=?,reviewed_at=? WHERE id=?",[b.status,b.reason.slice(0,500),req.user.id,now,r.id]);
    });
    back(res,c.id,"Review recorded");
  }));
  app.post(base+"/:id/policy",wrap(async(req,res)=>{
    const c=await context(req),b=req.body;
    if(req.user.role!=="admin")k.fail("Owner access required.",403);
    const limit=k.amount(b.limit,true),terms=Number(b.terms),block=Number(b.block),assigned=Number(b.assigned)||null;
    if(![terms,block].every(n=>Number.isInteger(n)&&n>=0&&n<=365))k.fail("Enter days from 0 to 365.");
    await db.transaction(async tx=>{
      await tx.one("SELECT id FROM w_users WHERE id=?"+db.lock,[c.id]);
      if(assigned&&!await tx.one("SELECT id FROM w_users WHERE id=? AND role IN ('salesperson','manager')",[assigned]))k.fail("Unknown staff ID.");
      await tx.run("DELETE FROM k_policy WHERE customer_id=?",[c.id]);
      await tx.run("INSERT INTO k_policy(customer_id,limit_paise,terms,block_days,assigned,consent) VALUES(?,?,?,?,?,?)",[c.id,limit,terms,block,assigned,b.consent==="yes"?1:0]);
      await tx.run("INSERT INTO w_audit(actor_id,event,created_at) VALUES(?,?,?)",[req.user.id,JSON.stringify({customer:c.id,limit,terms,block,assigned,consent:b.consent==="yes"}),new Date().toISOString()]);
    });back(res,c.id,"Policy updated");
  }));
}
module.exports={mount,ledger};
