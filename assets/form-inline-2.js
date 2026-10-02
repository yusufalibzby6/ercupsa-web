function embedInfo(url){
            try{
                const u = new URL(url);
                if(u.hostname === 'docs.google.com' && u.pathname.includes('/forms/')){
                    u.searchParams.set('embedded','true');
                    return { src: u.toString(), ok: true };
                }
                if(u.hostname === 'tally.so' && u.pathname.startsWith('/r/')){
                    const id = u.pathname.split('/r/')[1];
                    return { src: `https://tally.so/embed/${id}?hideTitle=1&alignLeft=1&transparentBackground=1&dynamicHeight=1`, ok: true };
                }
            }catch(e){}
            return { src: url, ok: false };
        }

        fetch('/api/events').then(r=>r.json()).then(({events=[]})=>{
            const now = new Date().toISOString().slice(0,10);
            const params = new URLSearchParams(location.search);
            const requestedId = params.get('event');

            let target = null;
            if(requestedId){
                target = events.find(e => e.id === requestedId && e.registrationUrl);
            }
            if(!target){
                target = events
                    .filter(e => e.date >= now && e.registrationUrl)
                    .sort((a,b) => a.date.localeCompare(b.date))[0];
            }

            if(!target){
                document.getElementById('formEmpty').classList.remove('hidden');
                return;
            }

            document.getElementById('formTitle').textContent = target.title;
            document.getElementById('formSub').textContent = target.category ? target.category : '';

            const info = embedInfo(target.registrationUrl);
            if(info.ok){
                document.getElementById('formFrame').src = info.src;
                document.getElementById('formWrap').classList.remove('hidden');
            } else {
                document.getElementById('fallbackLink').href = target.registrationUrl;
                document.getElementById('formFallback').classList.remove('hidden');
            }
        }).catch(()=>{
            document.getElementById('formEmpty').classList.remove('hidden');
        });
