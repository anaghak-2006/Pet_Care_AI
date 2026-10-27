const $=s=>document.querySelector(s);
const API_URL=(window.PETCARE_API_URL||'http://127.0.0.1:8000').replace(/\/+$/,'');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
const diff=d=>Math.round((new Date(d+'T00:00')-new Date(new Date().toDateString()))/864e5);
const fmt=d=>new Date(d+'T00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
let uid=100;const id=()=>++uid;

/* ---- data (replace with calls to the FastAPI backend) ---- */
let user=null,petId=1,page='today',signup=false;
let pets=[
 {id:1,name:'Mochi',species:'Dog',breed:'Golden retriever',dob:'2022-03-14',weight:28.4,sex:'Female',notes:'Allergic to chicken. Nervous around fireworks.',vet:'Dr. Rao, Indiranagar Pet Clinic'},
 {id:2,name:'Pixel',species:'Cat',breed:'Indian domestic shorthair',dob:'2024-08-02',weight:4.1,sex:'Male',notes:'Indoor cat. Likes the window seat.',vet:'Dr. Rao, Indiranagar Pet Clinic'}];
let vax=[
 {id:1,pet:1,name:'Rabies booster',due:day(12),done:false},{id:2,pet:1,name:'DHPPi',due:day(-6),done:false},{id:3,pet:1,name:'Kennel cough',due:day(70),done:false},
 {id:4,pet:2,name:'FVRCP booster',due:day(25),done:false},{id:5,pet:2,name:'Rabies',due:day(140),done:false}];
let diet=[
 {id:1,pet:1,meal:'Breakfast',time:'07:30',food:'Salmon kibble, 1.5 cups',on:true},{id:2,pet:1,meal:'Dinner',time:'19:00',food:'Salmon kibble, 1.5 cups + pumpkin',on:true},
 {id:3,pet:2,meal:'Morning',time:'08:00',food:'Wet food, 1 pouch',on:true},{id:4,pet:2,meal:'Evening',time:'20:00',food:'Dry food, 45 g',on:false}];
let records=[
 {id:1,pet:1,date:day(-40),type:'Checkup',note:'Healthy. Teeth look good. Weight 28.4 kg.',vet:'Dr. Rao'},
 {id:2,pet:1,date:day(-120),type:'Illness',note:'Upset stomach after eating chicken treats. Bland diet for 3 days.',vet:'Dr. Rao'},
 {id:3,pet:1,date:day(-200),type:'Vaccination',note:'DHPPi given.',vet:'Dr. Rao'},
 {id:4,pet:2,date:day(-60),type:'Checkup',note:'Deworming done. Weight 4.1 kg.',vet:'Dr. Rao'}];
let reports=[
 {id:1,kind:'lost',name:'Bruno',desc:'Brown beagle with a red collar, shy.',area:'Koramangala 5th Block',date:day(-1),contact:'98xxxxxx12',open:true},
 {id:2,kind:'found',name:'Unknown',desc:'Small white cat, blue eyes, no collar.',area:'HSR Layout Sector 2',date:day(-2),contact:'97xxxxxx45',open:true}];
let groom=[
 {id:1,pet:1,task:'Bath',due:day(5),every:4},{id:2,pet:1,task:'Nail trim',due:day(-2),every:3},{id:3,pet:2,task:'Brush and ear check',due:day(9),every:2}];
let visits=[
 {id:1,pet:1,date:day(9),time:'10:30',reason:'Rabies booster',clinic:'Indiranagar Pet Clinic',done:false},
 {id:2,pet:2,date:day(30),time:'17:00',reason:'Dental check',clinic:'Indiranagar Pet Clinic',done:false}];
let chat=[{me:0,t:'Hi, I’m the PetCareAI assistant. Ask me about feeding, vaccines or behaviour. I’m not a vet, so for anything urgent call your clinic.'}];
const sampleData={pets,vax,diet,records,reports,groom,visits,chat};
const cloneData=data=>JSON.parse(JSON.stringify(data));
function loadUserData(identity){
 let saved;
 try{saved=JSON.parse(localStorage.getItem(`petcare:data:${identity}`)||'null')}catch{}
 const data=saved&&typeof saved==='object'?{...cloneData(sampleData),...saved}:cloneData(sampleData);
 for(const key of Object.keys(sampleData))if(!Array.isArray(data[key]))data[key]=cloneData(sampleData[key]);
 ({pets,vax,diet,records,reports,groom,visits,chat}=data)
}
function saveUserData(){
 if(!user)return;
 try{localStorage.setItem(`petcare:data:${user.id??user.email}`,JSON.stringify({pets,vax,diet,records,reports,groom,visits,chat}))}catch{}
}
const cur=()=>pets.find(p=>p.id===petId);
const age=d=>{const m=Math.floor((Date.now()-new Date(d))/2629800000);return m<24?m+' months':Math.floor(m/12)+' years'};
const status=d=>{const n=diff(d);return n<0?['late',-n+' days overdue']:n<=14?['soon','in '+n+' days']:['ok','in '+n+' days']};

/* ---- auth ---- */
function authMode(s){signup=s;$('#nameBox').hidden=!s;$('#authTitle').textContent=s?'Create your account':'Welcome back';$('#authSub').textContent=s?'Set up a space for your pet’s care.':'Log in to see what your pet needs today.';$('#authBtn').textContent=s?'Create account':'Log in';$('#aPass').autocomplete=s?'new-password':'current-password';$('#swTxt').textContent=s?'Already have one?':'New here?';$('#swBtn').textContent=s?'Log in':'Create an account';$('#authErr').textContent=''}
$('#swBtn').onclick=()=>authMode(!signup);
$('#authForm').onsubmit=async e=>{e.preventDefault();const em=$('#aEmail').value.trim().toLowerCase(),pw=$('#aPass').value,err=$('#authErr');
 if(!/^\S+@\S+\.\S+$/.test(em))return err.textContent='Enter a valid email address.';
 let name;
 if(signup){const nm=$('#aName').value.trim();if(!nm)return err.textContent='Tell us your name.';
  if(pw.length<8)return err.textContent='Password must be at least 8 characters.';
  name=nm}
 const button=$('#authBtn');button.disabled=true;err.textContent='';
 try{const response=await fetch(`${API_URL}/${signup?'register':'login'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(signup?{name,email:em,password:pw}:{email:em,password:pw})});
  const result=await response.json();if(!response.ok){err.textContent=typeof result.detail==='string'?result.detail:'Unable to authenticate. Check your details and try again.';return}
  user=result.user;loadUserData(user.id??user.email);$('#auth').style.display='none';$('#app').style.display='block';go('today')
 }catch{err.textContent='Could not connect to the server. Make sure the PetCareAI backend is running.'}
 finally{button.disabled=false}};

/* ---- shell ---- */
const tabs=[['today','Today'],['pets','Pet profile'],['health','Health history'],['plans','Reminders'],['ai','Ask the assistant'],['lost','Lost & found'],['scan','Photo scan']];
function go(p){page=p;
 $('#nav').innerHTML='<div class="logo"><span class="brand-mark" aria-hidden="true">P</span>PetCareAI</div><span class="nav-label">Workspace</span>'+tabs.map(t=>`<button class="n" data-p="${t[0]}" ${t[0]===p?'aria-current="page"':''}>${t[1]}</button>`).join('')+'<button class="n out" id="lo">Log out</button>';
 $('#nav').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>go(b.dataset.p));
 $('#lo').onclick=()=>{user=null;$('#app').style.display='none';$('#auth').style.display='grid';$('#aPass').value=''};
 draw();window.scrollTo(0,0)}
function chips(){return '<div class="pets" role="group" aria-label="Choose pet">'+pets.map(p=>`<button class="chip" data-pet="${p.id}" aria-pressed="${p.id===petId}">${esc(p.name)}</button>`).join('')+'</div>'}
function draw(){const v=$('#view');v.innerHTML=({today,pets:petsV,health,plans,ai,lost,scan}[page])();
 saveUserData();
 v.querySelectorAll('[data-pet]').forEach(b=>b.onclick=()=>{petId=+b.dataset.pet;draw()});(wire[page]||(()=>{}))(v)}

/* ---- views ---- */
function today(){const p=cur(),h=new Date().getHours();
 const due=[...vax.filter(x=>x.pet===p.id&&!x.done).map(x=>({n:x.name,d:x.due,k:'Vaccine'})),...groom.filter(x=>x.pet===p.id).map(x=>({n:x.task,d:x.due,k:'Grooming'})),...visits.filter(x=>x.pet===p.id&&!x.done).map(x=>({n:x.reason+', '+x.time,d:x.date,k:'Vet visit'}))].sort((a,b)=>a.d>b.d?1:-1).slice(0,5),meals=diet.filter(d=>d.pet===p.id&&d.on);
 return `<h2>Good ${h<12?'morning':h<17?'afternoon':'evening'}, ${esc(user.name.split(' ')[0])}</h2>${chips()}
 <div class="grid"><div class="card"><h3>${esc(p.name)}’s meals</h3>${meals.map(m=>`<div class="row"><span>${m.time} ${esc(m.meal)}<br><span class="mute">${esc(m.food)}</span></span></div>`).join('')||'<p class="mute">No meal reminders are on. Turn some on under Reminders.</p>'}</div>
 <div class="card"><h3>Coming up</h3>${due.map(x=>{const s=status(x.d);return `<div class="row"><span>${esc(x.n)}<br><span class="mute">${x.k}, ${fmt(x.d)}</span></span><span class="pill ${s[0]}">${s[1]}</span></div>`}).join('')||'<p class="mute">Nothing due. Nice work.</p>'}</div></div>
 <div class="card"><h3>Quick facts</h3><p class="mute">${esc(p.breed)}, ${age(p.dob)} old, ${p.weight} kg. Vet: ${esc(p.vet)}.</p></div>`}

function petsV(){const p=cur();
 return `<h2>Pet profile</h2>${chips()}
 <form class="card" id="pf"><h3>${esc(p.name)}</h3><div class="two">
 <div><label>Name</label><input name="name" value="${esc(p.name)}" required></div><div><label>Species</label><select name="species">${['Dog','Cat','Rabbit','Bird','Other'].map(s=>`<option ${s===p.species?'selected':''}>${s}</option>`).join('')}</select></div>
 <div><label>Breed</label><input name="breed" value="${esc(p.breed)}"></div><div><label>Birthday</label><input type="date" name="dob" value="${p.dob}"></div>
 <div><label>Weight (kg)</label><input type="number" step="0.1" name="weight" value="${p.weight}"></div><div><label>Sex</label><select name="sex">${['Female','Male'].map(s=>`<option ${s===p.sex?'selected':''}>${s}</option>`).join('')}</select></div></div>
 <label>Vet</label><input name="vet" value="${esc(p.vet)}"><label>Notes (allergies, habits)</label><textarea name="notes" rows="3">${esc(p.notes)}</textarea>
 <p class="err" id="pmsg" style="color:var(--ok)"></p><button class="btn">Save changes</button></form>
 <form class="card" id="np"><h3>Add another pet</h3><div class="two"><div><label>Name</label><input name="name" required></div><div><label>Species</label><select name="species"><option>Dog</option><option>Cat</option><option>Rabbit</option><option>Bird</option><option>Other</option></select></div></div><p style="margin-top:.8rem"><button class="btn ghost">Add pet</button></p></form>`}

function health(){const p=cur(),r=records.filter(x=>x.pet===p.id).sort((a,b)=>a.date<b.date?1:-1);
 return `<h2>Health history</h2>${chips()}
 <div class="card"><h3>Timeline</h3><div class="tl" style="margin-top:1rem">${r.map(x=>`<div class="it"><b>${esc(x.type)}</b> <span class="mute">${fmt(x.date)}, ${esc(x.vet)}</span><p>${esc(x.note)}</p></div>`).join('')||'<p class="mute">No records yet. Add the first one below.</p>'}</div></div>
 <form class="card" id="rf"><h3>Add a record</h3><div class="two"><div><label>Date</label><input type="date" name="date" value="${day(0)}" required></div>
 <div><label>Type</label><select name="type"><option>Checkup</option><option>Vaccination</option><option>Illness</option><option>Surgery</option><option>Medication</option></select></div></div>
 <label>Vet or clinic</label><input name="vet" value="${esc(p.vet.split(',')[0])}"><label>What happened</label><textarea name="note" rows="3" required></textarea><p style="margin-top:.8rem"><button class="btn">Save record</button></p></form>`}

function plans(){const p=cur(),v=vax.filter(x=>x.pet===p.id).sort((a,b)=>a.due>b.due?1:-1),d=diet.filter(x=>x.pet===p.id),g=groom.filter(x=>x.pet===p.id).sort((a,b)=>a.due>b.due?1:-1),vs=visits.filter(x=>x.pet===p.id&&!x.done).sort((a,b)=>a.date>b.date?1:-1);
 return `<h2>Reminders</h2>${chips()}
 <div class="card"><h3>Vaccinations</h3>${v.map(x=>{const s=status(x.due);return `<div class="row"><span>${esc(x.name)}<br><span class="mute">Due ${fmt(x.due)}</span></span>${x.done?'<span class="pill ok">Done</span>':`<span><span class="pill ${s[0]}">${s[1]}</span> <button class="btn sm ghost" data-done="${x.id}">Mark done</button></span>`}</div>`}).join('')}
 <form id="vf" class="two" style="margin-top:.8rem;align-items:end"><div><label>Vaccine</label><input name="name" required></div><div><label>Due date</label><input type="date" name="due" required></div><p style="margin-top:.8rem"><button class="btn ghost">Add reminder</button></p></form></div>
 <div class="card"><h3>Grooming</h3>${g.map(x=>{const s=status(x.due);return `<div class="row"><span>${esc(x.task)}<br><span class="mute">Next ${fmt(x.due)}, repeats every ${x.every} weeks</span></span><span><span class="pill ${s[0]}">${s[1]}</span> <button class="btn sm ghost" data-gdone="${x.id}">Done today</button></span></div>`}).join('')||'<p class="mute">No grooming reminders yet.</p>'}
 <form id="gf" class="two" style="margin-top:.8rem"><div><label>Task</label><select name="task"><option>Bath</option><option>Nail trim</option><option>Haircut</option><option>Teeth brushing</option><option>Ear cleaning</option><option>Brushing</option></select></div><div><label>Next due</label><input type="date" name="due" required></div><div><label>Repeat every (weeks)</label><input type="number" name="every" min="1" max="52" value="4" required></div><p style="margin-top:2.1rem"><button class="btn ghost">Add grooming reminder</button></p></form></div>
 <div class="card"><h3>Vet visits</h3>${vs.map(x=>{const s=status(x.date);return `<div class="row"><span>${esc(x.reason)}<br><span class="mute">${fmt(x.date)} at ${esc(x.time)}, ${esc(x.clinic)}</span></span><span><span class="pill ${s[0]}">${s[1]}</span> <button class="btn sm ghost" data-vdone="${x.id}">Attended</button> <button class="btn sm ghost" data-vcancel="${x.id}">Cancel</button></span></div>`}).join('')||'<p class="mute">No visits booked. Add one below.</p>'}
 <form id="vvf" class="two" style="margin-top:.8rem"><div><label>Reason</label><input name="reason" required placeholder="Annual checkup"></div><div><label>Clinic or doctor</label><input name="clinic" value="${esc(p.vet)}" required></div><div><label>Date</label><input type="date" name="date" required></div><div><label>Time</label><input type="time" name="time" value="10:00" required></div><p style="margin-top:.8rem"><button class="btn ghost">Book reminder</button></p></form></div>
 <div class="card"><h3>Diet plan</h3>${d.map(x=>`<div class="row"><span>${x.time} ${esc(x.meal)}<br><span class="mute">${esc(x.food)}</span></span><label style="margin:0;display:flex;gap:.4rem;align-items:center;font-weight:500"><input type="checkbox" style="width:auto" data-meal="${x.id}" ${x.on?'checked':''}>Remind me</label></div>`).join('')}
 <form id="df" class="two" style="margin-top:.8rem"><div><label>Meal</label><input name="meal" placeholder="Lunch" required></div><div><label>Time</label><input type="time" name="time" required></div><div style="grid-column:1/-1"><label>Food and amount</label><input name="food" required></div><p style="margin-top:.8rem"><button class="btn ghost">Add meal</button></p></form></div>`}

function ai(){return `<h2>Ask the assistant</h2>${chips()}<div class="card"><div class="chat" id="chat" aria-live="polite">${chat.map(m=>`<div class="msg ${m.me?'me':''}">${esc(m.t)}</div>`).join('')}</div>
 <form id="cf" style="display:flex;gap:.5rem;margin-top:.8rem"><input id="ci" placeholder="Is chocolate dangerous for dogs?" aria-label="Your question"><button class="btn">Send</button></form></div>`}
function reply(q){const p=cur(),s=q.toLowerCase();
 if(/chocolate|grape|onion|xylitol/.test(s))return `Chocolate, grapes, onions and xylitol are toxic to ${p.name}. If ${p.name} ate any, call ${p.vet.split(',')[0]} or an emergency vet now. Don’t wait for symptoms.`;
 if(/vaccin|shot/.test(s)){const n=vax.filter(x=>x.pet===p.id&&!x.done).sort((a,b)=>a.due>b.due?1:-1)[0];return n?`Next up for ${p.name} is ${n.name}, due ${fmt(n.due)} (${status(n.due)[1]}).`:`${p.name} has no vaccines pending.`}
 if(/food|diet|feed|meal/.test(s))return `${p.name}’s plan has ${diet.filter(x=>x.pet===p.id).length} meals a day. Change portions gradually over a week and check with your vet before big diet changes.`;
 if(/weight|fat|thin/.test(s))return `${p.name} weighs ${p.weight} kg. Log weight at each checkup so trends show up early. Sudden changes are worth a vet visit.`;
 if(/vomit|sick|blood|seizure|breath/.test(s))return 'That could be serious. Please contact your vet or an emergency clinic right away. I can’t diagnose, but I can help you note down when it started.';
 return 'I can help with feeding, vaccines, weight and everyday behaviour. Try asking about one of those, or add details about what you’ve noticed.'}

function lost(){const f=window.lf||'lost',list=reports.filter(r=>r.kind===f);
 return `<h2>Lost & found</h2><div class="tabs"><button class="chip" data-f="lost" aria-pressed="${f==='lost'}">Lost pets</button><button class="chip" data-f="found" aria-pressed="${f==='found'}">Found pets</button></div>
 <div class="card">${list.map(r=>`<div class="row" style="align-items:flex-start"><span><b>${esc(r.name)}</b> <span class="mute">${esc(r.area)}, ${fmt(r.date)}</span><br>${esc(r.desc)}<br><span class="mute">Contact: ${esc(r.contact)}</span></span>${r.open?`<button class="btn sm ghost" data-close="${r.id}">${f==='lost'?'Mark reunited':'Mark claimed'}</button>`:'<span class="pill ok">Closed</span>'}</div>`).join('')||'<p class="mute">No reports yet in your area.</p>'}</div>
 <form class="card" id="lf"><h3>Report a ${f} pet</h3><div class="two"><div><label>Pet name (or “Unknown”)</label><input name="name" required></div><div><label>Area</label><input name="area" required></div></div>
 <label>Description</label><textarea name="desc" rows="2" required placeholder="Colour, size, collar, microchip"></textarea><label>Contact number</label><input name="contact" required><p style="margin-top:.8rem"><button class="btn">Post report</button></p></form>`}

function scan(){return `<h2>Photo scan</h2><p class="mute" style="margin-top:.4rem">Upload a clear photo and our image model suggests the breed.</p>
 <div class="card"><label for="img" style="margin-top:0">Pet photo</label><input type="file" id="img" accept="image/*"><div id="out"></div></div>
 <p class="mute">Demo mode: results below are sample output. Connect the CNN endpoint to get real predictions.</p>`}

/* ---- behaviour ---- */
const wire={
 pets(v){v.querySelector('#pf').onsubmit=e=>{e.preventDefault();Object.assign(cur(),Object.fromEntries(new FormData(e.target)));cur().weight=+cur().weight;$('#pmsg').textContent='Saved.';saveUserData()};
  v.querySelector('#np').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target)),n={id:id(),breed:'',dob:day(-365),weight:0,sex:'Female',notes:'',vet:'',...f};pets.push(n);petId=n.id;draw()}},
 health(v){v.querySelector('#rf').onsubmit=e=>{e.preventDefault();records.push({id:id(),pet:petId,...Object.fromEntries(new FormData(e.target))});draw()}},
 plans(v){
  v.querySelectorAll('[data-gdone]').forEach(b=>b.onclick=()=>{const g=groom.find(x=>x.id==b.dataset.gdone);g.due=day(g.every*7);draw()});
  v.querySelector('#gf').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));groom.push({id:id(),pet:petId,...f,every:+f.every});draw()};
  v.querySelectorAll('[data-vdone]').forEach(b=>b.onclick=()=>{const x=visits.find(y=>y.id==b.dataset.vdone);x.done=true;records.push({id:id(),pet:petId,date:x.date,type:'Checkup',note:x.reason+' (visit completed).',vet:x.clinic.split(',')[0]});draw()});
  v.querySelectorAll('[data-vcancel]').forEach(b=>b.onclick=()=>{visits.splice(visits.findIndex(y=>y.id==b.dataset.vcancel),1);draw()});
  v.querySelector('#vvf').onsubmit=e=>{e.preventDefault();visits.push({id:id(),pet:petId,done:false,...Object.fromEntries(new FormData(e.target))});draw()};
  v.querySelectorAll('[data-done]').forEach(b=>b.onclick=()=>{vax.find(x=>x.id==b.dataset.done).done=true;draw()});
  v.querySelectorAll('[data-meal]').forEach(b=>b.onchange=()=>{diet.find(x=>x.id==b.dataset.meal).on=b.checked;saveUserData()});
  v.querySelector('#vf').onsubmit=e=>{e.preventDefault();vax.push({id:id(),pet:petId,done:false,...Object.fromEntries(new FormData(e.target))});draw()};
  v.querySelector('#df').onsubmit=e=>{e.preventDefault();diet.push({id:id(),pet:petId,on:true,...Object.fromEntries(new FormData(e.target))});draw()}},
 ai(v){const box=v.querySelector('#chat');box.scrollTop=box.scrollHeight;v.querySelector('#cf').onsubmit=e=>{e.preventDefault();const q=$('#ci').value.trim();if(!q)return;chat.push({me:1,t:q},{me:0,t:reply(q)});draw()}},
 lost(v){v.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{window.lf=b.dataset.f;draw()});
  v.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{reports.find(r=>r.id==b.dataset.close).open=false;draw()});
  v.querySelector('#lf').onsubmit=e=>{e.preventDefault();reports.unshift({id:id(),kind:window.lf||'lost',date:day(0),open:true,...Object.fromEntries(new FormData(e.target))});draw()}},
 scan(v){v.querySelector('#img').onchange=e=>{const f=e.target.files[0],o=$('#out');if(!f)return;if(!f.type.startsWith('image/')){o.innerHTML='<p class="err">Choose an image file (JPG or PNG).</p>';return}
  const u=URL.createObjectURL(f);o.innerHTML=`<img class="prev" src="${u}" alt="Your upload"><p class="mute">Analysing…</p>`;
  setTimeout(()=>{const r=[['Golden retriever',72],['Labrador retriever',19],['Mixed breed',9]];o.innerHTML=`<img class="prev" src="${u}" alt="Your upload"><h3>Best matches</h3>`+r.map(x=>`<div class="row"><span style="width:9rem">${x[0]}</span><div class="bar"><i style="width:${x[1]}%"></i></div><b>${x[1]}%</b></div>`).join('')},900)}}
};