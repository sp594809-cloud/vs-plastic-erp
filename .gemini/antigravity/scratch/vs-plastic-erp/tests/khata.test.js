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
