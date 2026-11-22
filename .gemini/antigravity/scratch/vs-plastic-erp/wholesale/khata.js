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
async function loadEntries(tx,id,until=null){
  const rows=await tx.all("SELECT * FROM k_entries WHERE customer_id=?"+(until?" AND posted<=?":"")+" ORDER BY id",until?[id,until]:[id]);
  const changes=await tx.all("SELECT x.sale_id,x.due FROM k_extensions x JOIN k_entries e ON e.id=x.sale_id WHERE e.customer_id=?"+(until?" AND x.created_at<?":"")+" ORDER BY x.id",until?[id,new Date(Date.parse(later(until,1))-19800000).toISOString()]:[id]);
  const byId=new Map(rows.map(e=>[e.id,e]));
  for(const x of changes){const e=byId.get(x.sale_id);if(e)e.due=x.due;}
  const targets=await tx.all("SELECT t.* FROM k_targets t JOIN k_entries e ON e.request_key=t.payment_key WHERE e.customer_id=?",[id]);
  const byKey=new Map(rows.map(e=>[e.request_key,e]));
  for(const t of targets){const e=byKey.get(t.payment_key);if(e)(e.targets??=[]).push(t);}
  return rows;
}
function summary(entries,day=today(),policy={}) {
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
    for(const target of e.targets||[]){
      const sale=open.find(x=>x.id===target.sale_id);
      if(!sale)continue;
      const used=Math.min(sale.left,target.amount,item.left);
      if(used){sale.left-=used;item.left-=used;allocations.push({debit:sale.id,credit:e.id,amount:used});}
    }
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
  const active=entries.filter(e=>!reversed.has(e.id)&&e.kind!=="reversal");
  const byId=new Map(active.map(e=>[e.id,e]));
  let weighted=0,collected=0,longest=0,late=0,onTime=0,settled=0;
  const settlement=new Map();
  for(const a of allocations){
    const sale=byId.get(a.debit),payment=byId.get(a.credit);
    if(sale.kind!=="sale"||payment.kind!=="payment")continue;
    const elapsed=Math.max(0,days(payment.posted,sale.posted));
    weighted+=elapsed*a.amount;collected+=a.amount;
    longest=Math.max(longest,days(payment.posted,sale.due));
    settlement.set(sale.id,payment.posted);
  }
  for(const e of open.filter(e=>e.kind==="sale"&&!e.left&&settlement.has(e.id))){
    settled++;if(settlement.get(e.id)<=e.due)onTime++;else late++;
  }
  const purchases=active.filter(e=>e.kind==="sale").map(e=>e.posted).sort();
  const receipts=active.filter(e=>e.kind==="payment").map(e=>e.posted).sort();
  const history={average:collected?Math.round(weighted/collected):null,longest,late,settled,onTime:settled?Math.round(100*onTime/settled):null,lastSale:purchases.at(-1),lastPayment:receipts.at(-1),repeat:purchases.length>1?Math.round(days(purchases.at(-1),purchases[0])/(purchases.length-1)):null};
  return {history,balance,sales,payments,unpaid,allocations,aging,maxDays,overdue:aging.slice(1).reduce((a,b)=>a+b,0),risk:maxDays>=(policy.red_days??31)?"Red":maxDays>=(policy.orange_days??15)?"Orange":maxDays>=(policy.yellow_days??1)?"Yellow":"Green"};
}
async function dispatchItems(tx,lock,key,actor){
  const items=await tx.all("SELECT * FROM k_items WHERE request_key=? ORDER BY product_id",[key]);
  for(const item of items){
    const product=await tx.one("SELECT stock,reserved,active FROM w_products WHERE id=?"+lock,[item.product_id]);
    if(!product?.active||product.stock-product.reserved<item.qty)fail("Insufficient available stock for "+item.name);
    await tx.run("UPDATE w_products SET stock=stock-? WHERE id=?",[item.qty,item.product_id]);
    await tx.run("INSERT INTO w_movements(product_id,actor_id,delta,reason,created_at) VALUES(?,?,?,?,?)",[item.product_id,actor,-item.qty,"Khata sale "+key,new Date().toISOString()]);
  }
}
async function quote(tx,lock,customer,b){
  const ids=[].concat(b.product||[]), quantities=[].concat(b.qty||[]);
  const selected=ids.map((id,i)=>({id:Number(id),qty:Number(quantities[i])})).filter(x=>x.id).sort((a,b)=>a.id-b.id);
  if(!selected.length||selected.length>50||new Set(selected.map(x=>x.id)).size!==selected.length)fail("Select distinct products.");
  let total=0;
  for(const x of selected){
    const p=await tx.one("SELECT * FROM w_products WHERE id=?"+lock,[x.id]);
    if(!p?.active||!Number.isSafeInteger(x.qty)||x.qty<p.moq||(x.qty-p.moq)%p.step||x.qty>p.stock-p.reserved)fail("Check available quantity and pack size.");
    const price=await require("./domain").priceFor(tx,p,customer,x.qty);
    if(price===null)fail("Configure the product price first.");
    const line=BigInt(price)*BigInt(x.qty),tax=(line*BigInt(p.tax)+5000n)/10000n;
    if(line+tax>99999999999n)fail("Item exceeds transaction limit.");
    total+=Number(line+tax);
    await tx.run("INSERT INTO k_items(request_key,product_id,sku,name,qty,unit_price,tax_rate,tax_amount) VALUES(?,?,?,?,?,?,?,?)",[b.key,p.id,p.sku,p.name,x.qty,price,p.tax,Number(tax)]);
  }
  if(total<=0||total>99999999999)fail("Sale total outside permitted range.");
  return total;
}
async function post(db,user,id,b){
  if(!["admin","manager","salesperson","accountant"].includes(user.role)) fail("Staff access required.",403);
  return db.transaction(async tx=>{
    const customer=await tx.one("SELECT id,status,tier_id FROM w_users WHERE role='customer' AND id=?"+db.lock,[id]);
    if(!customer) fail("Customer unavailable.",404);
    const policy=await tx.one("SELECT * FROM k_policy WHERE customer_id=?",[id]);
    if(["manager","salesperson"].includes(user.role)&&policy?.assigned!==user.id) fail("Customer is not assigned to you.",403);
    const stamp=new Date().toISOString(),kind=b.kind, note=String(b.note||"").trim().slice(0,500);
    if(!/^[a-f0-9-]{36}$/.test(b.key)) fail("Reload this form.");
    const old=await tx.one("SELECT customer_id,actor FROM k_entries WHERE request_key=?",[b.key])||await tx.one("SELECT customer_id,actor FROM k_requests WHERE request_key=?",[b.key]);
    if(old){if(old.customer_id!==id||old.actor!==user.id)fail("Request conflict.",409);return "Already recorded";}
    const entries=await loadEntries(tx,id);
    const state=summary(entries);
    let value, due=null, original=null, ref=null, method=null, posted=date(b.posted||today());
    if(posted>today()) fail("Future postings are unavailable.");
    if(kind==="reversal"){
      if(!["admin","accountant"].includes(user.role)||!note) fail("Authorized correction and reason required.",403);
      const target=entries.find(e=>e.id===Number(b.original));
      if(!target||target.kind==="reversal"||entries.some(e=>e.original===target.id)) fail("Entry cannot be reversed.");
      if(posted<target.posted)fail("Correction date precedes original entry.");
      value=target.amount; original=target.id;
    }else{
      value=kind==="sale"&&b.detailed==="yes"?await quote(tx,db.lock,customer,b):amount(b.amount);
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
          if(kind==="payment"&&b.target){
            const targets=[].concat(b.target),values=[].concat(b.apply||[]);
            let allocated=0;
            for(let i=0;i<targets.length;i++){
              if(!values[i])continue;
              const part=amount(values[i]),sale=state.unpaid.find(e=>e.id===Number(targets[i]));
              if(!sale||part>sale.left||posted<sale.posted)fail("Allocation exceeds eligible sale balance.");
              allocated+=part;if(allocated>value)fail("Allocations exceed payment.");
              await tx.run("INSERT INTO k_targets(payment_key,sale_id,amount) VALUES(?,?,?)",[b.key,sale.id,part]);
            }
          }
          method=b.method;ref=String(b.reference||"").trim()||null;
          if(ref&&ref.length>100)fail("Reference exceeds 100 characters.");
        }
      }
    }
    if(kind==="sale")await dispatchItems(tx,db.lock,b.key,user.id);
    await tx.run("INSERT INTO k_entries(customer_id,actor,kind,amount,posted,due,method,reference,original,request_key,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",[id,user.id,kind,value,posted,due,method,ref,original,b.key,note,stamp]);
    return "Entry recorded";
  });
}
module.exports={today,date,later,days,amount,summary,post,loadEntries,dispatchItems,fail,key:crypto.randomUUID};
