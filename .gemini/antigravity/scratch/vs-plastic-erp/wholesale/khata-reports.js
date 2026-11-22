const {today,summary,date,loadEntries}=require("./khata");
const {ledger}=require("./khata-routes");
const labels=["Shop","City","Category","Staff ID","Credit sales (INR)","Payments (INR)","Outstanding (INR)","Overdue (INR)","Oldest overdue (days)","Average collection (days)","On time (%)"];
const xml=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
function exportRows(res,format,name,rows){
 if(format==="excel"){
   const data=rows.map(row=>"<Row>"+row.map(v=>'<Cell><Data ss:Type="'+(typeof v==="number"?"Number":"String")+'">'+xml(v)+'</Data></Cell>').join("")+"</Row>").join("");
   return res.attachment(name+".xml").type("application/xml").send('<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Statement"><Table>'+data+'</Table></Worksheet></Workbook>');
 }
 const esc=v=>'"'+String(v??"").replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 return res.attachment(name+".csv").send("\ufeff"+rows.map(row=>row.map(esc).join(",")).join("\r\n"));
}
function register(app,db,wrap){
 app.get("/khata/reports/summary",wrap(async(req,res)=>{
  const user=req.user,q=req.query,day=today(),from=date(q.from||day.slice(0,7)+"-01"),to=date(q.to||day);
  if(from>to)throw Object.assign(new Error("Date range is reversed."),{status:400});
  const clauses=["u.role='customer'"],args=[];
  if(["manager","salesperson"].includes(user.role)){clauses.push("p.assigned=?");args.push(user.id);}
  for(const [key,col] of [["city","u.city"],["category","u.business_type"],["assigned","p.assigned"]]){
   if(q[key]){clauses.push(col+"=?");args.push(q[key]);}
  }
  const users=await db.all("SELECT u.id,u.business,u.city,u.business_type,p.assigned FROM w_users u LEFT JOIN k_policy p ON p.customer_id=u.id WHERE "+clauses.join(" AND ")+" ORDER BY u.business",args);
  const rows=[];
  for(const c of users){
   const entries=await loadEntries(db,c.id,to);
   const state=summary(entries,to);let sales=0,payments=0;
   for(const r of ledger(entries).filter(e=>e.posted>=from)){
    const kind=r.kind==="reversal"?entries.find(e=>e.id===r.original).kind:r.kind;
    if(kind==="sale")sales+=r.delta;if(kind==="payment")payments-=r.delta;
   }
   rows.push([c.business,c.city,c.business_type,c.assigned||"",sales/100,payments/100,state.balance/100,state.overdue/100,state.maxDays,state.history.average,state.history.onTime]);
  }
  if(["csv","excel"].includes(q.format))return exportRows(res,q.format,"khata-report",[labels,...rows]);
  res.render("khata-report",{labels,rows,q,from,to});
 }));
}
module.exports={register,exportRows};
