fetch('/api/events').then(r=>r.json()).then(({events=[]})=>{
    const now=new Date().toISOString().slice(0,10);

    // Yaklaşan etkinlikler
    const list=events.filter(e=>e.date>=now).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3);
    const elEvents=document.getElementById('home-events');
    if(elEvents) elEvents.innerHTML=list.map(e=>`<a href="etkinlikler.html" class="glass-panel rounded-3xl overflow-hidden hover:-translate-y-1 transition flex-shrink-0 w-[78vw] sm:w-[60vw] md:w-auto snap-center">${e.poster?`<img decoding="async" src="${ercupsaEscape(e.poster)}" class="w-full aspect-[4/5] object-cover">`:''}<div class="p-5"><div class="text-xs font-bold text-ercupsaRed">${ercupsaEscape(e.category||'Etkinlik')}</div><h3 class="font-black text-lg mt-1">${ercupsaEscape(e.title)}</h3><p class="text-sm text-gray-500 mt-2">${new Date(e.date+'T12:00:00').toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})}${e.location?' • '+e.location:''}</p></div></a>`).join('')||'<div class="w-full text-center text-gray-500 py-8">Yaklaşan etkinlikler yakında burada.</div>';

    // Son anılarımız — 4'erli, mümkünse döngülü (aynı veriden besleniyor, ekstra istek yok)
    const photos=events.flatMap(e=>(e.images||[]).map(img=>({url:img.url,eventId:e.id}))).reverse().slice(0,16);
    const elPhotos=document.getElementById('home-photos');
    if(elPhotos){
        if(!photos.length){
            elPhotos.innerHTML='<p class="col-span-2 md:col-span-4 text-center text-gray-500 py-6 text-sm">Fotoğraflar yakında burada.</p>';
        } else {
            const chunks=[]; for(let i=0;i<photos.length;i+=4) chunks.push(photos.slice(i,i+4));
            let idx=0;
            const renderChunk=()=>{ elPhotos.innerHTML=chunks[idx].map(p=>`<a href="galeri.html#event-${ercupsaEscape(p.eventId)}" class="block aspect-square rounded-2xl overflow-hidden"><img decoding="async" src="${ercupsaEscape(p.url)}" loading="lazy" class="w-full h-full object-cover hover:scale-105 transition duration-300"></a>`).join(''); };
            renderChunk();
            if(chunks.length>1){
                setInterval(()=>{
                    elPhotos.style.opacity='0';
                    setTimeout(()=>{ idx=(idx+1)%chunks.length; renderChunk(); elPhotos.style.opacity='1'; },300);
                },5000);
            }
        }
    }

    // Sayaç şeridi — etkinlik sayısı, aynı veriden
    const evCounter=document.getElementById('eventCounter');
    if(evCounter) evCounter.dataset.target=events.length;

    // Canlı geri sayım — en yakın etkinliğe, aynı veriden
    const nextEvent = list[0];
    const cdWrap = document.getElementById('countdownWrap');
    if(cdWrap && nextEvent){
        cdWrap.classList.remove('hidden');
        document.getElementById('countdownLabel').textContent = nextEvent.title;
        const target = new Date(nextEvent.date+'T09:00:00').getTime();
        const tick = () => {
            const diff = target - Date.now();
            if(diff <= 0){ cdWrap.classList.add('hidden'); clearInterval(timer); return; }
            const d = Math.floor(diff/86400000);
            const h = Math.floor((diff%86400000)/3600000);
            const m = Math.floor((diff%3600000)/60000);
            const s = Math.floor((diff%60000)/1000);
            document.getElementById('cdDays').textContent = d;
            document.getElementById('cdHours').textContent = String(h).padStart(2,'0');
            document.getElementById('cdMins').textContent = String(m).padStart(2,'0');
            document.getElementById('cdSecs').textContent = String(s).padStart(2,'0');
        };
        tick();
        const timer = setInterval(tick, 1000);
    }
}).catch(()=>{});

document.addEventListener('DOMContentLoaded', () => {
    // Scroll'da belirme animasyonu
    const io = new IntersectionObserver((entries) => {
        entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in-view'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));

    // Sayaç sayma animasyonu
    function animateCounter(el){
        const target = parseInt(el.dataset.target,10)||0;
        const dur = 1200; const start = performance.now();
        function tick(now){
            const p = Math.min((now-start)/dur,1);
            el.textContent = Math.floor(p*target);
            if(p<1) requestAnimationFrame(tick); else el.textContent = target;
        }
        requestAnimationFrame(tick);
    }
    const counterIO = new IntersectionObserver((entries)=>{entries.forEach(en=>{if(en.isIntersecting){animateCounter(en.target);counterIO.unobserve(en.target)}})},{threshold:0.5});
    document.querySelectorAll('.counter').forEach(el=>counterIO.observe(el));
});
