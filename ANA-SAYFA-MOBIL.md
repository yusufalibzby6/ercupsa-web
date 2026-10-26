# ERCUPSA mobil öncelikli ana sayfa

Değişiklikler yerel ortamda tamamlandı. GitHub push, Netlify üretim dağıtımı veya üretim verisi değişikliği yapılmadı.

## Son görsel revizyon: eczacılık teması

Kullanıcının daha iddialı ve görsel ağırlıklı tasarım talebiyle açılış; derin bordo, krem tipografi, molekül çizgileri ve özgün kapsül/erlen illüstrasyonuyla yenilendi. Katmanlı etkinlik ve geri sayım kartı, kısa mobil akış ve önceki tüm işlevler korunur. Figma aracı bu oturumda kullanılamadı; tasarım Figma üzerinde yapılmış olarak sunulmaz.

Yeni görsel bu çalışma için üretildi ve yerel WebP dosyaları olarak eklendi: `assets/home-pharmacy-art-small.webp` (480 × 480, 40.988 bayt), `assets/home-pharmacy-art.webp` (960 × 960, 127.906 bayt). Saydamlık korunur; responsive `srcset` küçük ekranlarda küçük dosyayı seçer. Yeni dış görsel servisi veya bağımlılık yoktur.

Bu revizyonda 32/32 ana sayfa/gizlilik tarayıcı testi yeniden geçti. Sekiz genişliğin açık ve koyu temada 16 birleşiminde taşma, JavaScript hatası veya eksik görsel isteği saptanmadı. Örnek etkinlikte 390 × 844 ekranda geri sayımın altı 751 px, kayıt düğmesinin altı 810 px; ikisi de ilk ekran içinde. Sayaç etiketlerinin açık tema kontrastı güçlendirildi.

Yeni ekranlar `/workspace/ercupsa-home-review/pharmacy-*.png`, ölçümler `pharmacy-qa-metrics.json` altındadır. Aşağıdaki 6.270 → 1.482 px karşılaştırması önceki kompakt tasarımın ölçümüdür; görsel revizyonun güncel yüksekliği olarak kullanılmamalıdır. Yeni görsel ağırlıklı sürüm, yaklaşan örnek etkinlik ve geçmiş albümlerle 390 px genişlikte 1.843 px ölçülmüştür.

## İçerik sırası ve tasarım

1. 64 px mobil başlık ve açılır menü.
2. ERCUPSA’yı açıklayan kısa giriş, “Etkinlikleri keşfet” ve “Kayıt formları”.
3. En yakın etkinliğin kompakt afişi, adı, tarih/saat/konumu, doğrulanmış kayıt durumu ve geri sayım.
4. Bilim / Deneyim / Dayanışma için tek satırda üç küçük bağlantı.
5. Varsa sıradaki en fazla iki etkinlik. Öne çıkan etkinlik burada tekrar edilmez.
6. Son iki geçmiş buluşma ve mevcut albümlere giden, en fazla altı fotoğraflı yatay şerit.
7. Yalnızca yayımlanmış yıllık için kısa duyuru.
8. İstenince açılan Instagram bölümü ve footer’da birer Instagram, WhatsApp, LinkedIn ikon bağlantısı.

“187 aktif üye”, etkinlik sayısı ve sosyal medya sayısı tanıtım bandı, büyük paragraf kartları, tekrarlanan sosyal çağrılar ve ilk ziyaret karşılama penceresi ana sayfadan kaldırıldı. Admin istatistikleri veya bunları besleyen veriler silinmedi. Yaklaşan etkinlik yoksa büyük afiş alanı yerine kısa bilgi gösterilir. Geçmiş etkinlik bağlantısı mevcut ana sayfa listesini veya galeri albümlerini açar.

Stiller `.home-page` kapsamında; bordo, beyaz ve krem korunur. Mobil açılışın 125 px üst boşluğu kaldırıldı. Başlık boyutları, kartlar ve boşluklar mobilde küçültüldü; geniş ekranda giriş ve etkinlik yan yana yerleştirildi. Menü açıkken içerik aşağı itilmez. Escape, dışarı dokunma, klavyeyle odaktan çıkma ve ekran genişliği değişimi desteklenir. Dokunma hedefleri en az 44 px; hareket azaltma ve karanlık tema korunur. Uzun başlık, kategori, konum ve yıllık metinleri kesilmeden satıra geçer.

## Geri sayımın kaynağı ve sınırları

Kaynak mevcut `GET /api/events` yanıtındaki `id`, `published`, `date` (`YYYY-MM-DD`) ve `time` (`HH:mm`) alanlarıdır. Yeni veritabanı alanı veya yönetici ayarı gerekmez. Etkinliğin yerel saati projenin mevcut kuralıyla Türkiye saati, UTC+03:00 olarak yorumlanır; cihazın saat dilimi süreyi değiştirmez. Ekrandaki saat TSİ olarak belirtilir.

Sayaç yalnızca en yakın yaklaşan etkinlikte gün/saat/dakika/saniye gösterir. Saniyeler yalnızca ilgili metin düğümlerini günceller, her saniye API isteği yapılmaz. Etkinlik başladığı anda sonraki yaklaşan etkinliğe geçilir; kalmadığında sayaç kaldırılır. Kayıt durumu geç gelirse klavye odağı korunur; geri sayım geçişi fotoğraf şeridini yeniden oluşturmaz.

Geçersiz takvim tarihi ve yayımlanmamış etkinlik öne çıkamaz. Tarihi geçerli olup saati eksik/geçersiz olan etkinlik keşfedilebilir, ancak saat uydurulmaz ve sayaç gösterilmez. Bu etkinlikler Türkiye takvimine göre gün sonunda geçmişe geçer. Sayaç ziyaretçinin cihaz saatini kullanır; sunucu saatine senkronizasyon için yeni servis veya gereksiz istek eklenmemiştir.

Kayıt/yedek/dolu durumu mevcut native kayıt API’sinden doğrulanır. Doğrulanamayan veya kapalı form için kayıt açıkmış gibi davranılmaz. Native form eski Google Forms bağlantısına düşmez. Kayıt ve bekleme listesi altyapısı değiştirilmedi.

## Galeri, Instagram ve performans

`galeri.html`, `assets/gallery.css`, `assets/galeri-inline-*.js`, `style.css`, `fun.js`, `assets/shell.js` ve `assets/events-common.js` korunur. Ana sayfanın fotoğraf kartları mevcut Cloudinary URL’leri ve `galeri.html#event-…` albüm bağlantılarını kullanır. Dosya taşıma, silme veya yükleme yapılmadı.

Fotoğraf şeridi elle kaydırılır; otomatik döngü kaldırıldı. Ekran dışı görseller lazy-loading kullanır. Ağır kütüphane veya video eklenmedi. Ana sayfa artık genel shell/efekt/karşılama betiklerini yüklemez; diğer sayfalardaki davranış değişmez.

Instagram varsayılan olarak kapalı bir ayrıntı satırıdır. Önceden izin verilmiş olsa bile bölüm açılmadan SDK yüklenmez. Hem izin hem açma olduğunda gömmeler hazırlanır. Bölüm kapanınca iframe’ler kaldırılır; izin geri alma, sekmeler arası tercih ve tarayıcı depolaması kullanılamadığında sayfalık tercih korunur. Genel KVKK veya yıllık altyapısı değiştirilmedi.

## Değiştirilen dosyalar

| Dosya | Değişiklik |
| --- | --- |
| `index.html` | İçerik sırası, tanıtımların kaldırılması, kompakt menü/footer ve bölüm yapısı |
| `assets/home-v2.css` | Ana sayfaya özel mobil ve masaüstü tasarım |
| `assets/index-inline-3.js` | Etkinlikler, canlı sayaç, durumlar ve galeri önizlemesi |
| `assets/home-pharmacy-art-small.webp`, `assets/home-pharmacy-art.webp` | Özgün eczacılık illüstrasyonunun mobil/masaüstü sürümleri |
| `assets/home-event-model.js` | Saf tarih/saat doğrulama, sıralama ve süre hesabı |
| `assets/home-navigation.js` | Ana sayfaya özel menü ve tema |
| `assets/index-inline-1.js` | Depolama kapalıyken güvenli tema başlangıcı |
| `assets/home-v2.js` | Yayımlanmış yıllığın kısa açıklaması |
| `assets/home-instagram.js`, `assets/home-instagram.css` | Kompakt, izinle yüklenen Instagram bölümü |
| `tests/home-event-model.test.mjs` | Tarih, saat dilimi ve sınır birim testleri |
| `tests/browser/home-mobile.spec.js` | Yeni mobil, sayaç, erişilebilirlik ve uzun metin senaryoları |
| `tests/browser/home-privacy.spec.js` | Korunan izin akışı ve kapalı bölüm kontrolleri |
| `tests/browser/improvements.spec.js`, `tests/browser/site.spec.js` | Kaldırılan tanıtımlara ilişkin eski beklentilerin güncellenmesi |
| `ANA-SAYFA-MOBIL.md` | Bu rapor |

## Yerel ekran karşılaştırması

Aynı public etkinlik kaydı ve 390 × 844 görünümünde, izin verilmemiş/Instagram kapalı başlangıç için:

| Ölçüm | Önce | Sonra |
| --- | ---: | ---: |
| Mobil toplam sayfa yüksekliği | 6270 px | 1482 px |
| Yaklaşan etkinlik yokken boş kart yüksekliği | 431 px | 105 px |
| Masaüstü toplam sayfa yüksekliği, 1440 px | 4397 px | 1487 px |

Mobilde yaklaşık %76 daha kısa. Ayrı bir örnek yaklaşan etkinlik senaryosunda geri sayım 634 px, kayıt düğmesinin altı 694 px konumunda; ikisi de ilk 844 px içinde. Bu örnek etkinlik yalnızca yerel ekran testi içindir, site verisine eklenmedi.

Önce/sonra ve geri sayım ekranları `/workspace/ercupsa-home-review/` altında saklandı; site dosyalarına eklenmedi. Test ortamında Cloudinary alanına ağ erişimi sınırlı olduğundan ekran görüntülerinde yerel görsel karşılıkları kullanıldı; gerçek URL’ler ve canlı dosyalar değiştirilmedi. Bu ölçümler aynı yerel test verisiyle yerleşim karşılaştırmasıdır; canlı ağ hızı/Lighthouse puanı olarak sunulmaz.

## Doğrulama

- `npm run build`: başarılı.
- `npm test`: 311/311 başarılı; bunların dördü yeni saf tarih/geri sayım testi.
- Toplam 67 farklı tarayıcı senaryosu doğrulandı. Son ana sayfa/gizlilik turu 32/32 başarılı; kalan ilgili regresyonlar da geçti.
- Mobil ve ilgili regresyon kontrolleri: 320, 360, 375, 390, 430, 768, 1024 ve 1440 px; uzun metinler, taşma ve 44 px hedefler.
- Türkiye/başka cihaz saat dilimi, saniye güncellemeleri, başlangıç sınırında sıradaki etkinliğe geçiş, tarih/saat eksikliği ve son etkinliğin başlaması.
- Mevcut form, native/yedek/dolu durumları, Google Forms yönlendirmesi, galeri arama/filtre/ışık kutusu, Instagram yönetimi ve izinleri, genel gezinme, QR bilet çıktı kontrolleri.
- Korunan galeri/ortak dosyaların SHA-256 kontrolü ve `git diff --check`: temiz.

GitHub ve üretim dağıtımı son kullanıcı onayını bekler. Bilinen uygulama engeli yok; gerçek Cloudinary ağ performansı bu ortamda ölçülemedi.
