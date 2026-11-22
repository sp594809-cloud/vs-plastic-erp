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
