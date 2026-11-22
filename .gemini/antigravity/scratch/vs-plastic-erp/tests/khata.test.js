const {test}=require("node:test"),assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite"),fs=require("node:fs"),path=require("node:path");
const k=require("../wholesale/khata"),{ledger}=require("../wholesale/khata-routes"),{candidate}=require("../wholesale/khata-reminders");
function setup(){
 const sql=new DatabaseSync(":memory:");sql.exec(fs.readFileSync(path.join(__dirname,"../wholesale/schema.sql"),"utf8"));
 sql.exec("PRAGMA foreign_keys=OFF; INSERT INTO w_users(id,email,password,role,status,business,contact,phone,business_type,city,state,pincode,address,created_at) VALUES(1,'buyer','','customer','approved','Test','','','','','','','',''),(2,'owner','','admin','approved','Staff','','','','','','','','');INSERT INTO k_policy(customer_id,limit_paise) VALUES(1,1000000)");
 const db={lock:"",async all(q,p=[]){return sql.prepare(q).all(...p)},async one(q,p=[]){return sql.prepare(q).get(...p)},async run(q,p=[]){return sql.prepare(q).run(...p)}};
 let queue=Promise.resolve();db.transaction=fn=>{const res=queue.then(async()=>{sql.exec("BEGIN");try{const v=await fn(db);sql.exec("COMMIT");return v}catch(e){sql.exec("ROLLBACK");throw e}});queue=res.catch(()=>{});return res};
 const add=(kind,amount,extra={},user={id:2,role:"admin"})=>k.post(db,user,1,{kind,amount,key:k.key(),method:"cash",...extra});
 const rows=()=>db.all("SELECT * FROM k_entries ORDER BY id");
 return {add,rows,db};
}
test("₹2,000 sale → ₹800 partial → ₹1,200 settlement; reminder eligibility follows open balance",async()=>{
 const {add,rows}=setup();await add("sale","2000",{due:k.today()});assert.equal(k.summary(await rows()).balance,200000);
 await add("payment","800");assert.equal(candidate(await rows(),[],k.today(),[0]).entry.left,120000);
 await add("payment","1200");assert.equal(k.summary(await rows()).balance,0);assert.equal(candidate(await rows(),[],k.today(),[0]),null);
});
test("concurrent retries and multi-sale allocation retain one payment",async()=>{
 const {add,rows}=setup();await add("sale","100");await add("sale","200");const key=k.key();
 await Promise.all([add("payment","250",{key}),add("payment","250",{key})]);
 const s=k.summary(await rows());assert.equal(s.balance,5000);assert.deepEqual(s.allocations.map(a=>a.amount),[10000,15000]);
});
test("advance, refund, reversal and audit balance",async()=>{
 const {add,rows}=setup();await add("payment","500");await add("refund","100",{note:"Returned cash"});
 await assert.rejects(add("refund","401",{note:"Excess"}));await add("reversal","",{original:"2",note:"Correction"});
 assert.equal(k.summary(await rows()).balance,-50000);assert.equal(ledger(await rows()).at(-1).balance,-50000);
 await assert.rejects(add("reversal","",{original:2,note:"Again"}));
});
test("credit limit violation requests approval and does not post",async()=>{
 const {add,rows,db}=setup();assert.equal(await add("sale","10001"),"Credit approval requested");assert.equal((await rows()).length,0);assert.equal((await db.all("SELECT * FROM k_requests")).length,1);
});
test("unauthorized users and unassigned salespeople rejected",async()=>{
 const {add}=setup();for(const role of ["customer","salesperson"]) await assert.rejects(add("sale","10",{},{role,id:3}));
});
test("past due aging, disqualification on dispute and duplicate external references",async()=>{
 const {add,rows}=setup();await add("sale","10",{posted:"2025-01-01",due:"2025-01-02"});
 assert.equal(k.summary(await rows(),"2025-01-10").aging[2],1000);assert.equal(candidate(await rows(),[{kind:"dispute"}],"2025-01-10",[8]),null);
 await add("payment","1",{reference:"T123"});await assert.rejects(add("payment","1",{reference:"T123"}));
});
test("posted corrections preserve historic delay and on-time figures",async()=>{
 const {add,rows}=setup();await add("sale","2000",{posted:"2025-02-01",due:"2025-02-15"});await add("payment","2000",{posted:"2025-02-21"});
 const h=k.summary(await rows()).history;assert.equal(h.average,20);assert.equal(h.longest,6);assert.equal(h.late,1);assert.equal(h.onTime,0);
});
test("private WhatsApp job checks remaining amount, records acceptance and suppresses duplicates",async()=>{
 const {add,db}=setup();await db.run("UPDATE k_policy SET consent=1");await add("sale","100",{due:k.today()});await add("payment","40");
 const env={WA_PHONE_ID:"123",WA_TOKEN:"fixture",WA_APPROVED_TEMPLATE:"fixture",WA_LANGUAGE:"gu",WA_GRAPH_VERSION:"v20.0"};
 let sent=0;const mock=async(url,options)=>{sent++;assert.equal(JSON.parse(options.body).template.components[0].parameters[1].text,"60.00");return {ok:true,json:async()=>({messages:[{id:"fixture"}]})}};
 const {run}=require("../wholesale/khata-reminders");await run(db,env,mock);await run(db,env,mock);assert.equal(sent,1);
 assert.equal((await db.one("SELECT status FROM k_deliveries")).status,"accepted");
});
function handlers(db){
 const map={};const app={use(){},post(path,fn){map["POST "+path]=fn},get(path,fn){map["GET "+path]=fn}};
 require("../wholesale/khata-routes").mount(app,db,fn=>fn);
 require("../wholesale/khata-reports").register(app,db,fn=>fn);
 return map;
}
test("manager cannot self-authorize exception; owner decision posts exactly once",async()=>{
 const {db,add,rows}=setup();await add("sale","10001");
 const fn=handlers(db)["POST /khata/:id/review"], req={user:{role:"manager",id:3},params:{id:"1"},body:{request:"1",status:"approved",reason:"Reviewed by owner"}};
 await assert.rejects(fn(req,{redirect(){}}));req.user={role:"admin",id:2};await fn(req,{redirect(){}});
 await assert.rejects(fn(req,{redirect(){}}));assert.equal((await rows()).length,1);assert.equal((await db.one("SELECT reviewer FROM k_requests")).reviewer,2);
});
test("promise only receives credit for recorded payments; reversal reopens amount",async()=>{
 const {db,add}=setup();await add("sale","2000");const routes=handlers(db);
 const req={user:{role:"admin",id:2},params:{id:"1"},query:{},body:{kind:"promise",amount:"500",date:k.today(),note:"Confirmed by phone"}};
 await routes["POST /khata/:id/contact"](req,{redirect(){}});
 async function left(){let amount;await routes["GET /khata/:id"](req,{render(_,v){amount=v.remaining(v.contacts[0])}});return amount;}
 assert.equal(await left(),50000);await add("payment","300");assert.equal(await left(),20000);
 await add("payment","200");assert.equal(await left(),0);await add("reversal","",{original:3,note:"Reconciliation"});assert.equal(await left(),20000);
});
test("targeted allocations and due-date extensions change open-invoice reminder schedule",async()=>{
 const {add,db}=setup();await add("sale","100",{due:k.today()});await add("sale","200",{due:k.today()});
 await add("payment","100",{target:"2",apply:"100"});
 const all=()=>k.loadEntries(db,1);assert.deepEqual(k.summary(await all()).unpaid.map(e=>e.left),[10000,10000]);
 await handlers(db)["POST /khata/:id/extend"]({params:{id:"1"},user:{role:"admin",id:2},body:{sale:"1",reason:"Agreed revised terms",due:k.later(k.today(),5)}},{redirect(){}});
 assert.equal(candidate(await all(),[],k.today(),[0]).entry.id,2);
});
test("only an owner can write off an overdue amount with a reason",async()=>{
 const {add,rows}=setup();await add("sale","200",{posted:"2025-01-01",due:"2025-01-02"});
 await assert.rejects(add("write_off","50",{note:"Review"},{role:"accountant",id:2}));
 await assert.rejects(add("write_off","201",{note:"Too large"}));
 await add("write_off","50",{note:"Documented decision"});assert.equal(k.summary(await rows()).balance,15000);
});
