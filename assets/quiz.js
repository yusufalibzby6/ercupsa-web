const questions = [
  {
    q: "Bir eczanede staj yaparken en çok hangi işi yapmak istersin?",
    options: [
      {
        text: "Yeni ilaç formülasyonları üzerine araştırma yapmak",
        type: "lab",
      },
      { text: "Müşterilerle sohbet edip önerilerde bulunmak", type: "sosyal" },
      {
        text: "Etkileşimleri ve mekanizmaları didik didik incelemek",
        type: "akademik",
      },
      { text: "Acil bir durumda hızlıca doğru çözümü bulmak", type: "kriz" },
    ],
  },
  {
    q: "Sınav haftasında sen hangisisin?",
    options: [
      {
        text: "Notlarımı en ince ayrıntısına kadar organize ederim",
        type: "akademik",
      },
      {
        text: "Arkadaşlarla grup çalışması yaparım, moral önemli",
        type: "sosyal",
      },
      { text: "Son ana kadar pratik yapıp tekrar ederim", type: "lab" },
      { text: "Stresliyim ama panik yapmadan planlı ilerlerim", type: "kriz" },
    ],
  },
  {
    q: "Boş vaktinde en çok ne yaparsın?",
    options: [
      { text: "Bilimsel içerik/belgesel izlerim", type: "akademik" },
      { text: "Arkadaşlarla vakit geçiririm", type: "sosyal" },
      { text: "Yeni bir şeyler denerim, karıştırırım", type: "lab" },
      { text: "Spor yaparım, enerjik kalırım", type: "kriz" },
    ],
  },
  {
    q: "Bir arkadaşın aniden senden yardım isterse ilk tepkin ne olur?",
    options: [
      { text: "Hemen yanına gidip pratik bir çözüm üretirim", type: "kriz" },
      { text: "Önce dinlerim, moral desteği veririm", type: "sosyal" },
      { text: "Sorunu adım adım analiz ederim", type: "akademik" },
      { text: "Farklı çözüm yollarını araştırıp denerim", type: "lab" },
    ],
  },
  {
    q: "Bir grup projesinde sana en çok hangi görev yakışır?",
    options: [
      { text: "Planlamayı ve zamanlamayı organize etmek", type: "kriz" },
      { text: "Ekip içi iletişimi ve motivasyonu sağlamak", type: "sosyal" },
      { text: "Sunumu/raporu hazırlamak", type: "akademik" },
      { text: "Yeni fikirler ve yöntemler önermek", type: "lab" },
    ],
  },
  {
    q: "Gelecekte kendini nerede görüyorsun?",
    options: [
      { text: "Ar-Ge laboratuvarında", type: "lab" },
      { text: "Kendi eczanemde, herkesi tanır hâlde", type: "sosyal" },
      { text: "Akademide, ders anlatırken", type: "akademik" },
      { text: "Hastanede, kritik anlarda fark yaratırken", type: "kriz" },
    ],
  },
];

const results = {
  lab: {
    emoji: "🧪",
    icon: "icons/emoji-lab.png",
    title: "Laboratuvar Aşığı",
    desc: 'Meraklısın, detaycısın ve yeni şeyler keşfetmeyi seviyorsun. Bir formülü didik didik edip "ya böyle olsa?" diye sormak tam sana göre. Ar-Ge senin doğal ortamın!',
  },
  sosyal: {
    emoji: "💊",
    icon: "icons/emoji-sosyal.png",
    title: "Sosyal Eczacı",
    desc: "İnsanlarla bağ kurmayı, onlara yardımcı olmayı seviyorsun. Bir gün mahalledeki herkesin güvendiği, tanıdığı eczacı sen olacaksın. Empati senin süper gücün!",
  },
  akademik: {
    emoji: "📚",
    icon: "icons/emoji-akademik.png",
    title: "Akademisyen Ruhlu",
    desc: "Bilgiye açsın, öğrenmeyi ve öğretmeyi seviyorsun. Detaylara hakim olmak, konuyu tam anlamak seni tatmin ediyor. Belki bir gün bu işi sen anlatıyor olursun!",
  },
  kriz: {
    emoji: "🚑",
    icon: "icons/emoji-kriz.png",
    title: "Kriz Yöneticisi",
    desc: "Soğukkanlısın, hızlı düşünürsün, baskı altında parlarsın. Herkes panikken sen çözümü buluyorsun. Hastane eczacılığı ya da acil servis tam senlik!",
  },
};

questions.push(
  {
    q: "Bir proje için hangi soruyu önce sorarsın?",
    options: [
      { text: "Nasıl deneyebiliriz?", type: "lab" },
      { text: "Kime fayda sağlayacak?", type: "sosyal" },
      { text: "Kaynaklar ne diyor?", type: "akademik" },
      { text: "Riskleri nasıl yönetiriz?", type: "kriz" },
    ],
  },
  {
    q: "Staj gününde en çok hangi an seni heyecanlandırır?",
    options: [
      { text: "Yeni bir analiz yöntemini görmek", type: "lab" },
      { text: "Bir danışanın sorusunu anlaşılır yanıtlamak", type: "sosyal" },
      { text: "Öğrendiğim konuyu arkadaşlarıma anlatmak", type: "akademik" },
      { text: "Yoğun bir anda ekibi organize etmek", type: "kriz" },
    ],
  },
  {
    q: "Boş bir öğleden sonra nasıl bir etkinlik seçersin?",
    options: [
      { text: "Formülasyon atölyesi", type: "lab" },
      { text: "Toplum sağlığı gönüllülüğü", type: "sosyal" },
      { text: "Bilimsel makale kulübü", type: "akademik" },
      { text: "Vaka çözüm çalışması", type: "kriz" },
    ],
  },
  {
    q: "Bir hata fark ettiğinde ilk yaklaşımın ne olur?",
    options: [
      { text: "Nedenini deneyerek bulurum", type: "lab" },
      { text: "Etkilenen kişiyi dinlerim", type: "sosyal" },
      { text: "Kanıtları ve yönergeleri incelerim", type: "akademik" },
      { text: "Önce riski kontrol altına alırım", type: "kriz" },
    ],
  },
);
let answers = [];
let current = 0;
const scores = { lab: 0, sosyal: 0, akademik: 0, kriz: 0 };

document.getElementById("startBtn").addEventListener("click", () => {
  document.getElementById("intro").classList.add("hidden");
  document.getElementById("quiz").classList.remove("hidden");
  renderQuestion();
});

function renderQuestion() {
  const q = questions[current];
  document.getElementById("questionCounter").textContent =
    `Soru ${current + 1} / ${questions.length}`;
  document.getElementById("backQuestion").disabled = current === 0;
  document.getElementById("progressBar").style.width =
    (current / questions.length) * 100 + "%";
  const wrap = document.getElementById("questionWrap");
  wrap.innerHTML = `
            <h2 class="text-xl md:text-2xl font-black mb-6 text-center">${q.q}</h2>
            <div class="space-y-3">
                ${q.options.map((o, i) => `<button data-i="${i}" class="option-btn w-full text-left glass-panel border-2 border-transparent rounded-2xl p-4 font-semibold">${o.text}</button>`).join("")}
            </div>
        `;
  wrap.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const opt = q.options[parseInt(btn.dataset.i, 10)];
      answers[current] = opt.type;
      current++;
      if (current < questions.length) {
        renderQuestion();
      } else {
        showResult();
      }
    });
  });
}

function showResult() {
  document.getElementById("progressBar").style.width = "100%";
  document.getElementById("quiz").classList.add("hidden");
  const resultEl = document.getElementById("result");

  Object.keys(scores).forEach(
    (k) => (scores[k] = answers.filter((a) => a === k).length),
  );
  const best = Math.max(...Object.values(scores));
  const tied = Object.keys(scores).filter((k) => scores[k] === best);
  let topType =
    answers
      .slice()
      .reverse()
      .find((k) => tied.includes(k)) || "lab";
  let topScore = -1;

  const r = results[topType];

  resultEl.innerHTML = `
            <div class="glass-panel rounded-[2rem] p-8 md:p-12 relative overflow-hidden">
                <div class="absolute -top-10 -right-10 w-40 h-40 bg-ercupsaRed/10 rounded-full blur-2xl pointer-events-none"></div>
                <div class="absolute -bottom-10 -left-10 w-40 h-40 bg-ercupsaAccent/10 rounded-full blur-2xl pointer-events-none"></div>

                <span class="badge-chip inline-block px-3 py-1 rounded-full text-ercupsaRed text-xs font-black tracking-widest uppercase mb-6 relative">Test Sonucun</span>

                <div class="w-32 h-32 mx-auto rounded-full flex items-center justify-center text-6xl mb-5 relative shadow-xl" style="background:linear-gradient(135deg,#A62B2B,#E23E4E)">
                    ${r.emoji}
                </div>

                <h2 class="text-3xl md:text-4xl font-black mb-4 relative bg-gradient-to-r from-ercupsaRed to-ercupsaAccent bg-clip-text text-transparent">${r.title}</h2>
                <p class="text-gray-600 max-w-lg mx-auto leading-relaxed mb-8 relative">${r.desc}</p>

                <div class="text-left my-5 space-y-3">${Object.keys(scores)
                  .map(
                    (k) =>
                      `<div><p class="text-sm font-bold">${results[k].title} · %${Math.round((scores[k] / questions.length) * 100)}</p><progress aria-label="${results[k].title}" max="${questions.length}" value="${scores[k]}" class="w-full"></progress></div>`,
                  )
                  .join("")}</div>
                ${tied.length > 1 ? '<p class="text-sm mb-4">Birden fazla yönün eşit çıktı. Son yanıtlarında öne çıkan yönünü başlıkta gösterdik.</p>' : ""}
                <p class="text-sm text-gray-500 mb-5">Bu test eğlence ve kendini keşfetme amaçlıdır; bilimsel bir kişilik veya kariyer değerlendirmesi değildir.</p>
                <button id="downloadResult" class="border rounded-xl p-3 mb-5">Sonuç kartını indir</button>
                <div class="border-t border-gray-200 pt-6 mb-6 relative">
                    <p class="font-bold text-sm mb-1">📸 Sonucunu Instagram hikayende paylaş!</p>
                    <p class="text-gray-500 text-sm mb-4">Bizi <span class="font-bold text-ercupsaRed">@ercupsa</span> etiketle, biz de seni sayfamızda paylaşalım.</p>
                    <button id="shareBtn" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-white shadow-lg" style="background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)">
                        <i class="fa-solid fa-share-nodes"></i> Sonucumu Paylaş
                    </button>
                </div>

                <div class="flex flex-wrap justify-center gap-3 relative">
                    <button id="retakeBtn" class="px-6 py-3 rounded-xl bg-gray-100 font-bold"><i class="fa-solid fa-rotate-right mr-2"></i>Tekrar Çöz</button>
                    <a href="https://chat.whatsapp.com/E9Rxa6ikg489pwGOyL0nTy?s=cl&p=i&ilr=2" target="_blank" rel="noopener noreferrer" class="px-6 py-3 rounded-xl btn-primary font-bold"><i class="fa-brands fa-whatsapp mr-2"></i>ERCUPSA'ya Katıl</a>
                </div>
            </div>
        `;
  resultEl.classList.remove("hidden");
  ercupsaConfetti(resultEl);

  document
    .getElementById("downloadResult")
    .addEventListener("click", async () => {
      const blob = await generateStoryImage(r);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ercupsa-test-sonucum.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  document.getElementById("retakeBtn").addEventListener("click", () => {
    answers = [];
    current = 0;
    Object.keys(scores).forEach((k) => (scores[k] = 0));
    resultEl.classList.add("hidden");
    document.getElementById("quiz").classList.remove("hidden");
    renderQuestion();
  });

  function isInAppBrowser() {
    const ua = navigator.userAgent || "";
    return /Instagram|FBAN|FBAV|Line\/|TikTok|MicroMessenger/i.test(ua);
  }

  document.getElementById("shareBtn").addEventListener("click", async () => {
    if (isInAppBrowser()) {
      ercupsaToast(
        '📱 Bu sayfa Instagram\'ın kendi tarayıcısında açık, paylaşımı kısıtlıyor. Sağ üstteki "•••" menüsünden "Tarayıcıda Aç"ı seçip tekrar dene!',
      );
      return;
    }

    const shareBtn = document.getElementById("shareBtn");
    const originalHtml = shareBtn.innerHTML;
    shareBtn.disabled = true;
    shareBtn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i> Hazırlanıyor...';

    try {
      const blob = await generateStoryImage(r);
      const file = new File([blob], "ercupsa-test-sonucu.png", {
        type: "image/png",
      });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "ERCUPSA - Hangi Eczacı Tipisin?",
          text: `Sonucum: ${r.title} ${r.emoji} — @ercupsa'yı etiketleyerek hikayende paylaş!`,
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ercupsa-test-sonucu.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        ercupsaToast(
          "Görsel indirildi! Instagram hikayene ekleyip @ercupsa'yı etiketleyebilirsin 📸",
        );
      }
    } catch (e) {
      // kullanıcı paylaşımı iptal ettiyse veya bir hata oluştuysa sessizce geç
    } finally {
      shareBtn.disabled = false;
      shareBtn.innerHTML = originalHtml;
    }
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + " ";
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function generateStoryImage(result) {
  const W = 1080,
    H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Arka plan — marka gradienti
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2b0f0f");
  bg.addColorStop(0.55, "#1A1A1A");
  bg.addColorStop(1, "#0d0d0d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Dekoratif ışık lekeleri
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.filter = "blur(2px)";
  ctx.fillStyle = "#E23E4E";
  ctx.beginPath();
  ctx.arc(W - 150, 260, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#A62B2B";
  ctx.beginPath();
  ctx.arc(120, H - 300, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Logo (varsa)
  try {
    const logo = await loadImage("ercupsa.PNG");
    const logoSize = 175;
    const logoY = 245;
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, logoY, logoSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(
      logo,
      W / 2 - logoSize / 2,
      logoY - logoSize / 2,
      logoSize,
      logoSize,
    );
    ctx.restore();
  } catch (e) {}

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Üst etiket
  ctx.fillStyle = "#E23E4E";
  ctx.font = "700 34px Arial, sans-serif";
  ctx.fillText("E R C U P S A", W / 2, 385);

  // Emoji rozeti
  const badgeGrad = ctx.createLinearGradient(
    W / 2 - 150,
    560,
    W / 2 + 150,
    860,
  );
  badgeGrad.addColorStop(0, "#A62B2B");
  badgeGrad.addColorStop(1, "#E23E4E");
  ctx.fillStyle = badgeGrad;
  ctx.beginPath();
  ctx.arc(W / 2, 710, 160, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "150px Arial, sans-serif";
  try {
    const emojiImg = await loadImage(result.icon);
    const iconSize = 190;
    ctx.drawImage(
      emojiImg,
      W / 2 - iconSize / 2,
      710 - iconSize / 2,
      iconSize,
      iconSize,
    );
  } catch (e) {
    ctx.fillStyle = "#ffffff";
    ctx.fillText(result.emoji, W / 2, 725);
  }

  // Alt başlık
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "700 32px Arial, sans-serif";
  ctx.fillText("HANGİ ECZACI TİPİSİN? SONUCUM:", W / 2, 970);

  // Sonuç başlığı
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 88px Arial, sans-serif";
  wrapText(ctx, result.title, W / 2, 1090, 920, 100);

  // Alt bilgi
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "500 34px Arial, sans-serif";
  ctx.fillText("Sen de test et 👉 ercupsa.com.tr/test.html", W / 2, 1770);

  ctx.fillStyle = "#E23E4E";
  ctx.font = "800 42px Arial, sans-serif";
  ctx.fillText("@ercupsa", W / 2, 1830);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

document.getElementById("backQuestion").addEventListener("click", () => {
  if (current > 0) {
    current--;
    renderQuestion();
  }
});
