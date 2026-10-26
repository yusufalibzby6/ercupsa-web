# ERCUPSA — sinematik tasarım ve hareket incelemesi

26 Ekim 2026 tarihindeki ek düzenlemeler bu raporun son bölümündedir; bu ek sürüm yerelde doğrulandı ve kullanıcı GitHub üzerinden yayımlanmasını onayladı. Önceki performans ölçümleri yayımlanan `8214f0f` sürümüne aittir.

Çalışma yerelde tamamlanıp doğrulandı; kullanıcı 26 Ekim 2026 tarihinde GitHub üzerinden yayımlanmasını onayladı. Üretim verilerine doğrudan müdahale edilmez. Önceden hazırlanmış “Son buluşmalar” kaldırma ve genel sayfa paleti düzenlemeleri korundu.

## Koddan önce yapılan inceleme

18 ziyaretçi/yönetim ekranı, mobil ve masaüstünde toplam 36 başlangıç görüntüsüyle incelendi. `home-v2.css`, `style.css`, sayfa stilleri, dinamik içerik üretimi ve ortak menü yapısı karşılaştırıldı.

| Alan | İnceleme ve karar |
| --- | --- |
| Ana sayfa | Mevcut eczacılık görseli, tipografi, bordo açılış ve krem kartlar korundu. Hareket katmanı eklendi. |
| Etkinlikler, Formlar, Test, Biletlerim | Önceki `site-palette.css` renkleri zaten uyumluydu. Yeniden renklendirilmedi. |
| Hakkımızda, Ekibimiz, SSS, İletişim, Topluluk | Mevcut bordo-krem palet korundu. Sayfaya uygun kısa hareketler eklendi. |
| Galeri | Üst menüdeki eski beyaz/kırmızı tonlar ana sayfadan alınan tonlara eşlendi; yalnızca başlık ve açıklama kısa giriş hareketi aldı. Albüm, filtre, arama, fotoğraf ve ışık kutusu düzeni korunur. |
| İçerik/çerez tercihleri | Renkler korundu. Kaydedilen hareket tercihi mevcut teknik saklama açıklamasına eklendi; animasyon veya yeni izin penceresi eklenmedi. |
| Dijital bilet, görevli giriş ekranı | İşlevsel tasarımları korundu. QR görseline, taşıyıcısına veya çıktısına hareket uygulanmaz. |
| Yıllık ve yıllık arşivi | Kendi uyumlu tasarımı ve hareket sistemi korunur. İkinci animasyon katmanı yüklenmez. |
| Eski üyeler bağlantısı | Mevcut etkinlikler yönlendirmesi korunur. |
| Admin paneli | Yerleşim ve yönetim işlemleri korundu. Eski mavi dış çerçeve bordo-krem renklere uyarlandı; yeni animasyon JavaScript’i yüklenmez. |

Renkler mevcut ana sayfa stillerinden alındı: `#7c2039`, `#4d162a`, `#a63c59`, `#fcf9f5`, `#fffdfa`, `#f5efe8`, `#e8dcd5`; koyu tema için mevcut genel palet kullanıldı. Yeni ve ayrı bir bordo paleti oluşturulmadı.

## Hareket sistemi

`assets/site-motion.js` ve `assets/site-motion.css`, sayfalara açıkça `motion-page` sınıfıyla eklenir. GSAP, video, WebGL, yeni servis veya bağımlılık kullanılmadı.

- Ana sayfa başlığı iki satırda kısa aralıklarla belirir. Başlangıç saydamlığı en az %65 olduğundan metin okunmak için animasyonu beklemez; toplam giriş yaklaşık 0,6 saniyede tamamlanır.
- Kapsülün mevcut tek parça WebP görseli hafifçe hareket eder. Mevcut SVG molekülleri, yörüngeler ve dört küçük parçacık bağımsız hareket eder. Mobilde yörünge/molekül döngüsü kapalıdır; yalnızca çok küçük kapsül hareketi ve iki parçacık kalır.
- Parallax yalnızca geniş ekran ve hassas fare işaretçisinde çalışır. Fare hareketi başına en fazla bir `requestAnimationFrame` planlanır; sürekli çalışan JavaScript çizim döngüsü yoktur.
- Kapsül alanı görünümden çıktığında ve sekme gizlendiğinde dekoratif hareketler durur.
- Bölüm başlıkları, etkinlik kartları, ekip kartları ve ana sayfa fotoğraf şeridi tek seferlik kısa girişler kullanır. Sayfa kaydırması yakalanmaz veya kilitlenmez.
- Yeni yüklenen kartlar yalnızca ilgili içerik kutularında izlenir. Sayaç her saniye bütün sayfayı tekrar taratmaz.
- Geri sayımda yalnızca değişen rakam kısa bir saydamlık geçişi alır. Rakamların taban genişliği ve kartın boyutu sabit kalır. Ekranın dışındaki rakamlar animasyon çalıştırmaz. Tarih/hesaplama kodu değiştirilmedi.
- Testin soru/seçenek/sonuç geçişleri mevcut sorular ve puanlamanın üzerine eklendi. Soru değişimi ve buton işlemleri animasyon tamamlanmasını beklemez.
- Form odağı, kontrol çerçeveleri ve başarı metinleri hafif geçişler kullanır. Hata/başarı renkleri korunur. Klavye odağı alan bir içeriğin giriş hareketi kesilir.
- Menüde erişilebilir bir duraklatma/sürdürme düğmesi vardır. Netlify’ın mevcut `/form` gibi uzantısız adresleri de desteklenir. Tercih tarayıcıda kaydedilir ve diğer ziyaretçi sayfalarına geçerken korunur.
- `prefers-reduced-motion` ve Save-Data dekoratif hareketleri kapatır. Düşük cihaz kaynaklarında daha kısa, yalnızca saydamlık kullanan geçişler uygulanır. Depolama veya IntersectionObserver bulunmadığında içerik görünür kalır.

Hiçbir içerik JavaScript’in onu görünür yapmasını beklemek üzere gizlenmez. Yeni stiller ekranda uygulanır; yazdırma düzenleri korunur.

## Eleştirel görsel değerlendirme

Mevcut güçlü açılış kompozisyonu ve kısa mobil hiyerarşi korunarak hareket yoğunluğu sınırlandı. Başlık, etkinlik tarihi ve kayıt butonları görsel efektlerin önünde kalır. Yeni bölüm veya uzun dekoratif sahne eklenmedi.

İncelemede ekip kartlarının eski 8 px sıçraması fazla bulundu ve 3 px’e indirildi. Test seçeneklerinin dokunurken yukarı kayması kaldırıldı. Fotoğraf şeridi elle kaydırılır; kullanıcıyı takip eden otomatik kaydırma eklenmedi. Genel sayfaların zaten uyumlu renkleri ve farklı amaçlara hizmet eden yıllık/bilet düzenleri korundu.

## Geri sayım ve korunan işlevler

Geri sayım mevcut `GET /api/events` yanıtındaki tarih, saat ve yayın durumunu kullanmaya devam eder. Saatler Türkiye saati UTC+03:00 olarak yorumlanır. Yayından kaldırılmış/çöp kutusundaki etkinlikler public katalogda yer almaz; model ayrıca `published: false` kayıtlarını dışlar. Etkinlik başlayınca sıradakine geçilir; geçerli yaklaşan etkinlik yoksa sayaç kaldırılır. Eksik saat için uydurma süre gösterilmez.

Kayıt/yedek/kontenjan, dekont yerine ödeme beyanı, bilet oluşturma, hesap/rozet, roller, istatistikler, denetim ve yıllık iş mantığı değiştirilmedi. Galeri fotoğraflarına veya Cloudinary kayıtlarına yazılmadı. Üniversiteyi veri sorumlusu gösteren bir metin veya yeni genel KVKK onayı eklenmedi.

## Değiştirilen dosyalar

Bu hareket geliştirmesinde:

| Dosya | Amaç |
| --- | --- |
| `assets/site-motion.js` | Görünürlük, kısa girişler, tercih/performans azaltma ve dinamik içerik entegrasyonu |
| `assets/site-motion.css` | Ortak hareket dili, kapsül/SVG hareketleri, dokunma ve menü uyumu |
| `assets/gallery-header.css` | Sadece galerinin üst menü ve başlık renkleri |
| `assets/admin-brand.css` | Sadece yönetim panelinin dış renk uyumu; ekran stilleri |
| `index.html` | Mevcut başlık satırlarının işaretlenmesi ve dört dekoratif parçacık; modül yükleme |
| `etkinlikler.html`, `form.html`, `test.html`, `biletler.html` | Sayfaya özel hareketlerin etkinleştirilmesi |
| `hakkimizda.html`, `ekip.html`, `sss.html`, `iletisim.html`, `topluluk.html` | Sayfaya özel hareketlerin etkinleştirilmesi |
| `galeri.html`, `admin.html` | İlgili sınırlı stil katmanlarının yüklenmesi |
| `cerezler.html` | Mevcut teknik saklama açıklamasında hareket tercihinin belirtilmesi |
| `tests/browser/motion.spec.js` | Beş yeni davranış testi |
| `ANA-SAYFA-MOBIL.md`, `SINEMATIK-TASARIM.md` | Uygulama ve doğrulama raporları |

`assets/site-palette.css`, `assets/home-v2.css`, `assets/index-inline-3.js` ve `tests/browser/home-mobile.spec.js` dosyalarındaki önceki düzenlemeler `8214f0f` sürümünde yayımlandı. “Son buluşmalar” kaldırılmıştır; geçmiş içerik bağlantısı galeriye gider.

## Testler

- `npm run build`: başarılı.
- `npm test`: **311/311** başarılı.
- Toplam **121 farklı tarayıcı testi** başarılı: ana sayfa/saat dilimi/geri sayım/gizlilik/galeri 35; hareket/form/paylaşım/özet/hesap/yönetici kabuğu ve roller 40; native kayıt/QR/dijital bilet/fotoğraflı sorular 43; test/gezinti 3.
- Yeni beş hareket testi: duraklatmanın sayfalar arasında korunması, canlı hareket azaltma tercihi ve çalışmaya devam eden sayaç, Save-Data/depolama kısıtlaması, gözlemci veya JavaScript yokken görünür içerik, ekran dışında duran kapsül ve boyutu değişmeyen sayaç.
- 320, 360, 375, 390, 430, 768, 1024 ve 1440 px genişliklerde, 14 ekran × 2 tema: **224 geometri kontrolü**. Taşma, küçük menü hedefi, eksik yerel dosya veya JavaScript hatası bulunmadı. Geometri karşılaştırması hareket azaltılmış durumda; normal hareket ayrıca davranış testleri ve dokunmatik mobil/masaüstü kayıtlarında kontrol edildi.
- Galeride **16 önce/sonra karşılaştırması**: albüm HTML’si, fotoğraf, mozaik, arama, filtre ve ışık kutusu stilleri aynı. Galerinin kendi CSS/JS dosyaları ile `style.css`, `fun.js`, `assets/shell.js` ve `assets/events-common.js` SHA-256 değerleri korundu. `galeri.html` yalnızca yeni üst stil/modül bağlantıları ve opt-in sınıfları nedeniyle değişti.
- Bilet testleri gerçek PNG ve A4 PDF çıktısını yeniden okuyup QR’yi çözümledi; kod okunabilirliği korundu. Admin yetki testleri sınırlı hesapların erişimini doğruladı.
- `node --check assets/site-motion.js` ve `git diff --check`: başarılı.

## Performans ölçümü ve sınırları

Aynı yerel içerik, Chromium, önbelleksiz ayrı bağlamlar ve üçer tekrarla hareket katmanı açık/kapalı karşılaştırıldı. Mobilde CPU 4 kat yavaşlatıldı. Gerçek Cloudinary ağı yerine yerel test görseli kullanıldı. Sonuçlar üretim Lighthouse skoru veya fiziksel iPhone/Android ölçümü değildir.

| Yerel ölçüm | Hareket öncesi medyan FCP/LCP | Hareket sonrası medyan FCP/LCP | Hareket sırasındaki CLS |
| --- | ---: | ---: | ---: |
| 390 px, CPU ×4 | 468 / 468 ms | 460 / 460 ms | 0 |
| 1440 px | 376 / 376 ms | 364 / 364 ms | 0 |

Kısa görünür alan örneklemesinde medyan kare aralığı yaklaşık 16,67 ms oldu; 34 ms’yi aşan kare görülmedi. Bu kısa sentetik ölçüm bütün cihazlarda 60 FPS garantisi değildir. İlk boyamadaki 8–12 ms farklar bu kısa yerel ölçümün dalgalanması içinde değerlendirilmelidir.

Ortak hareket JS/CSS’i toplam 19.710 bayt; gzip ile yaklaşık **5,6 KB**. Galeri üst stili gzip yaklaşık 452 B, admin renk stili yaklaşık 407 B. Bunlar dosya sıkıştırma ölçümleridir; gerçek aktarım sunucu sıkıştırmasına bağlıdır. Yeni video/görsel veya ücretli servis üretim sayfasına eklenmedi.

**Kalan performans konusu:** Etkinlik API yanıtının ilk boş görünümü gerçek etkinlik kartıyla değiştirmesinden doğan başlangıç yerleşim kayması bu çalışmadan önce de vardı. Testte toplam medyan CLS mobilde 0,176 → 0,179, masaüstünde 0,302 → 0,299 olarak ölçüldü. Hareket sırasında yeni kayma yoktur. Bu mevcut veri yükleme konusu gizlenmedi; büyük ve sürekli boş yer ayırarak mobil sayfa uzatılmadı.

## Yerel önizleme ve kayıtlar

- Çalışan önizleme: `http://localhost:8897/review/preview.html`
- Site önizlemesi: `http://localhost:8897/`
- Görüntü/video klasörü: `/workspace/ercupsa-motion-review/`
- Masaüstü kayıt: `cinematic-desktop.mp4`; mobil kayıt: `cinematic-mobile.mp4`.
- Başlangıç/final ekran görüntüleri, `matrix.json` ve `performance-paired.json` aynı klasördedir.

Önizleme ve kayıtlar örnek etkinlikler kullanır. Önizleme sunucusu üretim verilerine bağlanmaz; kayıt/yönetim POST işlemlerini reddeder. Önizleme dosyaları ve videolar depo/Netlify dağıtımına eklenmemiştir. Ortam kapatılırsa `/tmp/ercupsa-cinematic-preview.py` ile yerel sunucu yeniden başlatılabilir.

## 26 Ekim — bağlantılar, mobil kontroller ve güncel fotoğraflar

- Ana sayfadaki afiş/başlık ve “Detayları gör” bağlantıları, adminin “Etkinliği paylaş” işlemiyle aynı `/etkinlik/<id>` sayfasını açar. “Kayıt ol” ve “Yedek kayıt” doğrudan ilgili kayıt formuna gitmeye devam eder. Etkinlik kimliği gerçek kayıttan alınır; örnek bağlantı sabit yazılmadı.
- Ekibimiz, ana sayfanın ve ortak ziyaretçi menüsünün üst bağlantılarına eklendi.
- Tema ve animasyon düğmeleri tek bir erişilebilir grup içinde yan yana, aralarında boşlukla ve en az 44 × 44 px boyutta tutulur. Eski menü betiği önbellekte olsa da hareket modülü mevcut tema düğmesini gruplar.
- Galerinin kategori filtreleri, kategori rozetleri, albüm numaraları ve odak renkleri mevcut bordo paletine uyarlandı. Albüm/fotoğraf düzeni, arama, filtreleme ve ışık kutusu kodu değiştirilmedi.
- Normal mobil görünümde kapsülün hareketi 3 px/10 saniyeden 8 px/7 saniyeye çıkarıldı. Hafif moddaki cihazlarda da yalnızca kapsül için 4 px/8 saniyelik hareket korunur. Hareket azaltma, veri tasarrufu, kullanıcı duraklatması ve ekran dışında durma kuralları korunur. Gözlemci desteği olmayan tarayıcıda dekoratif sahne durur.
- Ana sayfanın en fazla altı fotoğrafı, son kaydedilen albümlerden seçilir. Sıralama mevcut sunucu `updatedAt` verisine, eski kayıtlarda etkinlik tarihine dayanır. Her albümün son iki geçerli fotoğrafı kullanılır; galeri kayıtlarının sırası değiştirilmez. Bu, fotoğraflara uydurma yükleme tarihi eklemez. Fotoğraflar panelde kaydedildikten sonra ana sayfa yeniden açılınca/yenilenince yeni veriler okunur.
- İlgili CSS/JS sürüm parametreleri yenilendi; eski önbellekteki menü ve bağlantıların yeni stillerle karışması önlenir.

Doğrulama: **61 tarayıcı testi**, **10 ilgili birim testi**, başarılı üretim build'i. Ayrıca ana sayfa, galeri, SSS ve ekip sayfalarında iki tema ve 320/360/375/390/430/768/899/900/1024/1440 px genişliklerle **80 görünüm** kontrol edildi; taşma veya düğmelerde üst üste binme bulunmadı. Yeni testler paylaşım sayfasına gerçek geçişi, kayıt formunun ayrı kalmasını, albüme yeni fotoğraf eklenip sayfa yenilenmesini ve hafif modda görünür hareketi kapsar.

Ekran kayıtları yerine bu ek sürümün kontrol görüntüleri `/workspace/ercupsa-followup-review/` altındadır. Kullanıcı ek sürümün GitHub üzerinden yayımlanmasını onayladı; üretim verilerine doğrudan müdahale edilmez.

## 26 Ekim — yıllığın yayın görünürlüğü ve silinmesi

Yıllık arşivi `/yilliklar.html`, tek yıllığın paylaşım adresi `/yillik/2026-2027` biçimindedir. Yayımlanan kopyalar mevcut ana sayfa duyurusunda da gösterilir. Canlı API'ye yalnızca okuma yapılarak bakıldığında arşiv boştu ve 2026–2027 için “Yıllık henüz yayımlanmamış” yanıtı alındı; taslak içerikleri okunmadı veya değiştirilmedi. Kullanıcı yalnızca onay penceresini gördüğünü bildirdi. Hangi doğrulamanın yayını engellediği özel taslak okunmadan kesinleştirilmedi.

- Yayın sonucu ve hata mesajı hem üstte hem işlem butonlarının hemen yanında gösterilir. Başarılı cevap yayımlanmış kopya içermedikçe arayüz “yayımlandı” demez.
- Başarılı yayında “Yayımlanan yıllığı aç” ve arşiv bağlantıları görünür. Kaydetme, etkinlik seçimi ve fotoğraf yayın kontrolü gereklilikleri butonların yanında açıklanır. Gelecekteki etkinlik ve fotoğraf uygunluğu denetimleri korunur; özel önizleme için yönetici bağlantısı kullanılabilir.
- Ana sayfanın ve ortak sayfaların alt bağlantılarına “Yıllıklar” eklendi.
- Baş admin, taslak veya yayımlanmış yıllığı onay vererek silebilir. Diğer yönetici izinleri silme yetkisi vermez; sunucu `requireOwner` kontrolü uygular. “Yayından kaldır” taslağı korumaya devam eder.
- Silme yıllığın taslağını, yayımlanan metin/fotoğraf referanslarını ve istatistik kopyasını kaldırır; etkinlikler, katılımcı kayıtları, biletler ve Cloudinary/galeri dosyaları korunur. Aynı dönem için yeniden boş taslak oluşturulabilir.
- Silme, mevcut kaydın ETag ve revision bilgileriyle koşullu yazılır. Eski bir düzenleme/sürmekte olan yayın silinmiş içeriği geri getiremez; eşzamanlı yeni düzenleme varsa eski silme isteği reddedilir.

Veri geçişi: Önceden var olan `version: 1` yıllıklar değişmeden okunur; toplu göç veya üretim temizliği yapılmaz. Silme anında aynı anahtara yalnızca kimlik, tarih, revision ve sınırlı işlem geçmişi içeren bir silme işareti yazılır; ayrı veri altyapısı kurulmaz. İşaret, aynı dönem yeniden oluşturulurken de koşullu yazmayla değiştirilir. Olası eski sürüme dönüşte silme işaretlerini anlayan yıllık API'si korunmalıdır.

Doğrulama: **315 birim testi** ve **44 ilgili tarayıcı testi** başarılı, üretim build'i başarılı. Yayının ana sayfa/arşiv görünümü, buton yanında hata, baş admin silme/onaydan vazgeçme, yetki sınırları, silinen bağlantının kapanması, aynı dönemi yeniden oluşturma ve eşzamanlı yayın/düzenleme/silme yarışları test edildi. Kullanıcı bu yazılım değişikliklerinin GitHub üzerinden yayımlanmasını onayladı; gerçek bir yıllık yayımlanmadı veya silinmedi.
