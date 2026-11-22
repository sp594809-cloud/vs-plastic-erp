const root=document.documentElement;
root.classList.toggle("dark",localStorage.getItem("khata-theme")==="dark");
document.querySelector("#theme").onclick=()=>localStorage.setItem("khata-theme",root.classList.toggle("dark")?"dark":"light");
document.querySelector("#print")?.addEventListener("click",()=>window.print());
function connection(){document.querySelector("#offline").hidden=navigator.onLine;}
connection();window.addEventListener("online",connection);window.addEventListener("offline",connection);
document.addEventListener("submit",e=>{
  const f=e.target;if(f.method!=="post")return;
  if(!navigator.onLine||f.dataset.sent||(f.dataset.confirm&&!confirm(f.dataset.confirm))){e.preventDefault();return;}
  f.dataset.sent="yes";
});
window.addEventListener("pageshow",()=>document.querySelectorAll("form[data-sent]").forEach(f=>delete f.dataset.sent));
const phrases={
"Collections overview":["વસૂલાતની ઝાંખી","वसूली का सारांश"],"Today's collection calls":["આજના વસૂલાત ફોન","आज की वसूली कॉल"],"Total outstanding":["કુલ બાકી","कुल बकाया"],"Overdue balance":["મુદત વીતી ગયેલી બાકી","अतिदेय बकाया"],"Collected today":["આજની વસૂલાત","आज की वसूली"],"Due today":["આજે લેવાના","आज देय"],"Receivables aging":["મુદત મુજબ બાકી","अवधि अनुसार बकाया"],"This month":["આ મહિને","इस महीने"],"Credit sales":["ઉધાર વેચાણ","उधार बिक्री"],"Collections":["વસૂલાત","वसूली"],"Over limit":["મર્યાદાથી વધુ","सीमा से अधिक"],"Promises due":["ચુકવણીનાં વચનો","भुगतान के वादे"],"Customer accounts":["ગ્રાહક ખાતાં","ग्राहक खाते"],"Search":["શોધો","खोजें"],"Collection queue":["વસૂલાત યાદી","वसूली सूची"],"Outstanding":["બાકી રકમ","बकाया"],"Approved limit":["મંજૂર મર્યાદા","स्वीकृत सीमा"],"Credit purchases":["ઉધાર ખરીદી","उधार खरीद"],"Payments received":["મળેલાં પેમેન્ટ","प्राप्त भुगतान"],"Quick credit sale":["ઉધાર વેચાણ નોંધો","उधार बिक्री दर्ज करें"],"Receive payment":["પેમેન્ટ મેળવો","भुगतान प्राप्त करें"],"Amount (₹)":["રકમ (₹)","राशि (₹)"],"Due date":["ચુકવણીની મુદત","देय तिथि"],"Note":["નોંધ","टिप्पणी"],"Method":["ચુકવણીનો પ્રકાર","भुगतान का तरीका"],"Payment date":["ચુકવણી તારીખ","भुगतान तिथि"],"Payment reference":["ચુકવણી સંદર્ભ","भुगतान संदर्भ"],"Customer ledger":["ગ્રાહક ખાતાવહી","ग्राहक खाता"],"Detailed product sale":["વસ્તુ મુજબ વેચાણ","वस्तुवार बिक्री"],"Repayment history":["ચુકવણીનો ઇતિહાસ","भुगतान इतिहास"],"From":["શરૂઆત","से"],"To":["અંત","तक"],"Type":["પ્રકાર","प्रकार"],"Filter":["ગાળો","छाँटें"],"Print / PDF":["પ્રિન્ટ / PDF","प्रिंट / PDF"],"Date / ID":["તારીખ / ક્રમાંક","तिथि / क्रमांक"],"Entry":["નોંધ","प्रविष्टि"],"Note / Reference":["નોંધ / સંદર્ભ","टिप्पणी / संदर्भ"],"Change":["ફેરફાર","बदलाव"],"Balance":["સિલક","शेष"],"Collection follow-up":["વસૂલાત અનુસરણ","वसूली फॉलो-अप"],"Call customer":["ગ્રાહકને ફોન કરો","ग्राहक को कॉल करें"],"Open WhatsApp message":["WhatsApp મેસેજ ખોલો","WhatsApp संदेश खोलें"],"Record outcome":["પરિણામ નોંધો","परिणाम दर्ज करें"],"Payment receipt":["ચુકવણીની પહોંચ","भुगतान रसीद"],"Receipt":["પહોંચ","रसीद"],"Amount received":["મળેલ રકમ","प्राप्त राशि"],"Reference":["સંદર્ભ","संदर्भ"],"Recorded by":["નોંધ કરનાર","दर्जकर्ता"],"Credit approvals":["ઉધાર મંજૂરી","उधार स्वीकृति"],"Credit policy & messaging consent":["ઉધાર નીતિ અને મેસેજ સંમતિ","ऋण नीति और संदेश सहमति"],"Accounting corrections":["હિસાબી સુધારા","लेखा सुधार"],"Receivables report":["બાકી રકમનો અહેવાલ","बकाया रिपोर्ट"]
};
const language=document.querySelector("#language");
language.value=localStorage.getItem("khata-language")||"en";
function translate(){
 const lang=language.value;root.lang=lang;
 if(lang==="en")return;
 const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let node;node=walk.nextNode();){
   if(node.parentElement.closest("option,input,textarea,td,.row"))continue;
   const original=node.textContent.trim(),entry=phrases[original];
   if(entry)node.textContent=node.textContent.replace(original,entry[lang==="gu"?0:1]);
 }
}
language.onchange=()=>{localStorage.setItem("khata-language",language.value);location.reload();};translate();
