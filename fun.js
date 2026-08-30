/* ERCUPSA — eğlenceli efektler: konfeti + logo easter egg */

function ercupsaConfetti(originEl) {
    const colors = ['#A62B2B', '#E23E4E', '#F2994A', '#ffffff', '#8B2323'];
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    let originX = canvas.width / 2, originY = canvas.height / 3;
    if (originEl && originEl.getBoundingClientRect) {
        const r = originEl.getBoundingClientRect();
        originX = r.left + r.width / 2;
        originY = r.top + r.height / 2;
    }

    const pieces = Array.from({ length: 120 }, () => ({
        x: originX,
        y: originY,
        vx: (Math.random() - 0.5) * 14,
        vy: Math.random() * -14 - 4,
        size: Math.random() * 7 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 20,
        shape: Math.random() > 0.5 ? 'rect' : 'circle'
    }));

    let frame = 0;
    function tick() {
        frame++;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        pieces.forEach(p => {
            p.vy += 0.35;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr;
            if (p.y < canvas.height + 20) alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.fillStyle = p.color;
            if (p.shape === 'rect') {
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });
        if (alive && frame < 240) {
            requestAnimationFrame(tick);
        } else {
            canvas.remove();
        }
    }
    tick();
}

/* Logoya 5 kere tıklayınca komik easter egg */
function ercupsaInitLogoEasterEgg(selector) {
    const logo = document.querySelector(selector);
    if (!logo) return;
    let clicks = 0;
    let resetTimer = null;

    logo.addEventListener('click', (e) => {
        clicks++;
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => { clicks = 0; }, 1800);

        if (clicks >= 5) {
            clicks = 0;
            e.preventDefault();
            ercupsaEmojiRain();
            ercupsaToast('Meraklı biri buradan geçti! 🎉 Tam bir ERCUPSA ruhu taşıyorsun 💊');
        }
    });
}

function ercupsaEmojiRain() {
    const emojis = ['💊', '🧪', '⚗️', '🩺', '🔬'];
    for (let i = 0; i < 26; i++) {
        const el = document.createElement('div');
        el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        el.style.position = 'fixed';
        el.style.left = Math.random() * 100 + 'vw';
        el.style.top = '-40px';
        el.style.fontSize = (Math.random() * 20 + 20) + 'px';
        el.style.zIndex = '9999';
        el.style.pointerEvents = 'none';
        el.style.transition = `transform ${2 + Math.random() * 1.5}s linear, opacity 0.5s ease ${1.8 + Math.random()}s`;
        document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.style.transform = `translateY(${window.innerHeight + 80}px) rotate(${Math.random() * 360}deg)`;
            el.style.opacity = '0';
        });
        setTimeout(() => el.remove(), 4200);
    }
}

function ercupsaToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '32px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    toast.style.background = 'linear-gradient(135deg, #A62B2B, #E23E4E)';
    toast.style.color = '#fff';
    toast.style.padding = '14px 22px';
    toast.style.borderRadius = '999px';
    toast.style.fontWeight = '700';
    toast.style.fontSize = '14px';
    toast.style.boxShadow = '0 10px 30px rgba(166,43,43,0.4)';
    toast.style.zIndex = '10000';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .35s ease, transform .35s ease';
    toast.style.maxWidth = '90vw';
    toast.style.textAlign = 'center';
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

/* WhatsApp'a Katıl linklerine otomatik konfeti — her sayfada, her buton için ayrı kod gerekmez */
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href*="chat.whatsapp.com"]');
        if (link) ercupsaConfetti(link);
    });
});
