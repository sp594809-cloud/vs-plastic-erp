const {chromium}=require("playwright");
const {randomBytes}=require("node:crypto");
const fs=require("node:fs");
Object.assign(process.env,{NODE_ENV:"test",WHOLESALE_SQLITE_PATH:":memory:",ADMIN_EMAIL:"test@example.invalid",ADMIN_PASSWORD:randomBytes(24).toString("hex"),SESSION_SECRET:randomBytes(32).toString("hex"),PORT:"0"});
const {start,db}=require("../server");
(async()=>{
 const server=await start();
 let browser;
 try{
  for(const statement of fs.readFileSync(__dirname+"/khata-demo.sql","utf8").split(";").filter(x=>x.trim()))await db.run(statement);
  browser=await chromium.launch();
  const base="http://127.0.0.1:"+server.address().port;
  for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:850}});
   const errors=[];page.on("pageerror",e=>errors.push(e.message));
   await page.goto(base+"/login");
   await page.locator('form[action="/login"] input[name=email]').fill(process.env.ADMIN_EMAIL);
   await page.locator('form[action="/login"] input[name=password]').fill(process.env.ADMIN_PASSWORD);
   await page.locator('form[action="/login"] button[type=submit],form[action="/login"] button:not([type])').last().click();
   await page.goto(base+"/khata");
   await page.getByRole("heading",{name:"Collections overview"}).waitFor();
   await page.getByRole("link",{name:/DEMO · Curtain showroom/}).click();
   await page.getByRole("heading",{name:"DEMO · Curtain showroom"}).waitFor();
   for(const [kind,value] of [["sale","2000"],["payment","800"],["payment","1200"]]){
    const form=page.locator("form").filter({has:page.locator('input[name=kind][value='+kind+']')}).filter({has:page.locator("input[name=amount]")}).first();
    await form.locator("input[name=amount]").fill(value);await form.locator("button").click();await page.getByRole("status").filter({hasText:"Entry recorded"}).waitFor();
   }
   if(!(await page.locator(".metrics article").first().innerText()).includes("₹0.00"))throw Error("Incorrect closing balance");
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error("Overflow at "+width);
   await page.locator("#theme").click();await page.selectOption("#language","gu");await page.waitForFunction(()=>document.documentElement.lang==="gu");
   if(errors.length)throw Error(errors.join("; "));await page.close();
   console.log("PASS "+width+"px: sign-in, dashboard, credit sale, partial and final payment, ledger, language and theme");
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
