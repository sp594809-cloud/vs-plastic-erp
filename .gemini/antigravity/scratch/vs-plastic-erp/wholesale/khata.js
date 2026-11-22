const crypto = require("node:crypto");
const DAY = 86400000;
const today = () => new Date(Date.now()+19800000).toISOString().slice(0,10);
function fail(message, status=400) { throw Object.assign(new Error(message),{status}); }
function amount(s, zero=false) {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(s))) fail("Enter a rupee amount with up to two decimal places.");
  const [whole,part=""] = String(s).split(".");
  const value = Number(whole)*100+Number(part.padEnd(2,"0"));
  if (!zero && value===0) fail("Amount must be positive.");
  return value;
}
function date(s) {
  if (!/^\d{4}-\d\d-\d\d$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s) fail("Invalid date.");
  return s;
}
const days = (a,b) => Math.round((Date.parse(a)-Date.parse(b))/DAY);
const later = (s,n) => new Date(Date.parse(s)+n*DAY).toISOString().slice(0,10);
function summary(entries,day=today()) {
  const reversed = new Set(entries.filter(e=>e.kind==="reversal").map(e=>e.original));
  const open=[], credits=[], allocations=[];
  let sales=0, payments=0, balance=0;
  for (const e of [...entries].sort((a,b)=>a.posted.localeCompare(b.posted)||a.id-b.id)) {
    if (reversed.has(e.id)||e.kind==="reversal") continue;
    const debit=["sale","refund"].includes(e.kind);
    balance += debit?e.amount:-e.amount;
    if(e.kind==="sale") sales+=e.amount;
    if(e.kind==="payment") payments+=e.amount;
    const item={...e,left:e.amount};
    const opposite=debit?credits:open;
    for(const other of opposite) {
      if (!item.left) break;
      if (!other.left) continue;
      const used=Math.min(item.left,other.left);
      item.left-=used; other.left-=used;
      allocations.push({debit:debit?item.id:other.id,credit:debit?other.id:item.id,amount:used});
    }
    (debit?open:credits).push(item);
  }
  const unpaid=open.filter(e=>e.left);
  const aging=[0,0,0,0,0,0,0];
  for(const e of unpaid){const n=days(day,e.due||e.posted);aging[n<=0?0:n<=7?1:n<=15?2:n<=30?3:n<=60?4:n<=90?5:6]+=e.left;}
  const maxDays=Math.max(0,...unpaid.map(e=>days(day,e.due||e.posted)));
  return {balance,sales,payments,unpaid,allocations,aging,maxDays,overdue:aging.slice(1).reduce((a,b)=>a+b,0),risk:maxDays>30?"Red":maxDays>14?"Orange":maxDays?"Yellow":"Green"};
}
async function post(db,user,id,b){
  if(!["admin","manager","salesperson","accountant"].includes(user.role)) fail("Staff access required.",403);
  return db.transaction(async tx=>{
    const customer=await tx.one("SELECT id,status FROM w_users WHERE role='customer' AND id=?"+db.lock,[id]);
    if(!customer) fail("Customer unavailable.",404);
    const policy=await tx.one("SELECT * FROM k_policy WHERE customer_id=?",[id]);
    if(["manager","salesperson"].includes(user.role)&&policy?.assigned!==user.id) fail("Customer is not assigned to you.",403);
    const stamp=new Date().toISOString(),kind=b.kind, note=String(b.note||"").trim().slice(0,500);
    if(!/^[a-f0-9-]{36}$/.test(b.key)) fail("Reload this form.");
    const old=await tx.one("SELECT customer_id,actor FROM k_entries WHERE request_key=?",[b.key])||await tx.one("SELECT customer_id,actor FROM k_requests WHERE request_key=?",[b.key]);
    if(old){if(old.customer_id!==id||old.actor!==user.id)fail("Request conflict.",409);return "Already recorded";}
    const entries=await tx.all("SELECT * FROM k_entries WHERE customer_id=? ORDER BY id",[id]);
    const state=summary(entries);
    let value, due=null, original=null, ref=null, method=null, posted=date(b.posted||today());
    if(posted>today()) fail("Future postings are unavailable.");
    if(kind==="reversal"){
      if(!["admin","accountant"].includes(user.role)||!note) fail("Authorized correction and reason required.",403);
      const target=entries.find(e=>e.id===Number(b.original));
      if(!target||target.kind==="reversal"||entries.some(e=>e.original===target.id)) fail("Entry cannot be reversed.");
      value=target.amount; original=target.id;
    }else{
      value=amount(b.amount);
      if(kind==="sale"){
        if(!["admin","manager","salesperson"].includes(user.role)||customer.status!=="approved")fail("Approved customer and sales access required.",403);
        due=date(b.due||later(posted,policy?.terms??14));
        if(due<posted)fail("Due date precedes sale.");
        if(state.balance+value>(policy?.limit_paise??0)||state.maxDays>(policy?.block_days??7)){
          await tx.run("INSERT INTO k_requests(customer_id,actor,amount,due,note,request_key,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)",[id,user.id,value,due,note,b.key,stamp]);
          return "Credit approval requested";
        }
      }else{
        if(!["payment","refund","credit_note"].includes(kind)||!["admin","accountant"].includes(user.role))fail("Accounting access required.",403);
        if(kind!=="payment"&&!note)fail("Record the reason.");
        if(kind==="refund"&&value>Math.max(0,-state.balance))fail("Refund exceeds available advance.");
        if(kind==="payment"||kind==="refund"){
          if(!["UPI","cash","bank","cheque","other"].includes(b.method))fail("Select a payment method.");
          method=b.method;ref=String(b.reference||"").trim()||null;
          if(ref&&ref.length>100)fail("Reference exceeds 100 characters.");
        }
      }
    }
    await tx.run("INSERT INTO k_entries(customer_id,actor,kind,amount,posted,due,method,reference,original,request_key,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",[id,user.id,kind,value,posted,due,method,ref,original,b.key,note,stamp]);
    return "Entry recorded";
  });
}
module.exports={today,date,later,days,amount,summary,post,fail,key:crypto.randomUUID};
