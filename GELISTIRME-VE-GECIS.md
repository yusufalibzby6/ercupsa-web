# Kayıt, raporlar ve ERCUPSA yıllığı

Bu değişiklikler mevcut Netlify Functions, Netlify Blobs, Supabase ve Cloudinary yapısını kullanır. Yeni ücretli servis, bağımlılık, SQL migration veya zorunlu ortam değişkeni eklenmez. Kodun hazırlanması canlı veriyi değiştirmez; GitHub push ve canlı dağıtım ayrıca yapılır.

## Kayıt ve ödeme

Formdaki asıl kontenjan korunur. Yeni `waitlist.enabled`, `waitlist.capacity`, `showRemainingCapacity` ve `payment.enabled` ayarları eklenir. Yedek ve sayaç varsayılan olarak kapalıdır. Kayıtlar `main`, `waitlisted`, `cancelled` durumlarından birindedir; bu alanı olmayan eski başvurular asıl kabul edilir. Eski genel onay/red alanı ödeme veya kabul kararı sayılmaz.

Asıl başvuruda ödeme bildirimi açıksa kutuyu işaretlemek gerekir. Göndermeden önce işaret kaldırılabilir. Yedek başvuruda ödeme istenmez. Ödeme kontrolü kabul durumundan ayrıdır: yeni ücretli asıl başvuruda `pending`, kontrolden sonra `approved` tutulur. Form ayarını değiştirmek eski verilmiş biletleri kendiliğinden iptal etmez.

Baş yönetici kaydı iptal edebilir: kayıt ve geçmişi korunur; başvurunun bileti kullanılamaz. Asıl yer boşalınca veya kontenjan artınca sıradaki yedek atomik işlemle asıla geçirilir; listede yükseltme zamanı ve denetimde işlem görülebilir. Ücretli etkinlikte asıla geçen kişinin ödeme durumu ayrıca bekler. İptal ve silme baş yöneticiye özeldir; yeni görüntüleme yetkileri bunları devretmez.

Asıl/yedek tahsisi, sıra numarası, form değişiklikleri ve ilgili denetim girdileri aynı ETag koşullu durum yazımında tutulur. Tekrar gönderimde aynı başvuru ikinci yer kullanmaz. Sayaç kapalıyken public form yanıtı kontenjan/başvuru sayısını döndürmez. Açık olduğunda yalnızca asıl kontenjan ve boş yer bilgisi eklenir. Sınırsız formda anlamsız sayı gösterilmez.

`ercupsa-registrations/state/<eventId>.json` kanonik kayıt olmaya devam eder; yapı sürümü 1 korunur ve alanlar eklenir. Kanonik kayıt yoksa eski form/cevap dosyaları okunur, ilk başarılı değişiklikte kanonik durum oluşturulur. Silinmiş kayıtların eski dosyalardan geri doğmasına izin verilmez.

## Fotoğraf, dekont ve izin

Yeni dekont yükleme kaldırılmıştır; özel fotoğraf soruları ve fotoğraflı seçenekler korunur. Eski dekont dosyaları otomatik silinmez. Üretim verisi silme bu geliştirme kapsamında çalıştırılmaz.

`node scripts/receipt-cleanup.mjs --help` salt okunur envanter aracını açıklar. Araç yalnızca bağlı Netlify Blobs ortamında referans/dosya sayılarını raporlar; dekont içeriğini indirmez, kişisel cevapları rapora yazmaz ve silme yolu içermez. Çalıştırılacak ortam ayrıca doğrulanmalıdır. Gerçek temizlik öncesinde mevcut referanslar ve saklama ihtiyacı değerlendirilip ayrı açık silme talimatı alınmalıdır; kayıt, bilet ve fotoğraf depoları topluca temizlenmemelidir.

Her yeni formda fotoğraf/video yayın izni isteğe bağlı, boş gelen ayrı bir kutudur. Tercih, `media-1` metin sürümü, `website`/`instagram` kanalları ve zaman tutulur. Eski kayıtların izni bilinmiyor kabul edilir. Bu izin ödeme bildirimiyle veya bekleyen genel KVKK aydınlatmasıyla birleştirilmez. Veri sorumlusu bilgisi gelene kadar genel KVKK metni ve zorunlu onay eklenmemiştir.

Ana sayfada Instagram gömmeleri ziyaretçi izin vermeden yüklenmez. Reddetme, doğrudan bağlantıyı açma ve tercihi değiştirme kullanılabilir. Tercih geri alınınca gömülü içerik kaldırılır; yüklenen üçüncü taraf betiğini sayfadan çıkarmak için sayfa yenilenir. Tarayıcının daha önce oluşturduğu üçüncü taraf çerezlerini site silemez. Teknik bilgi `cerezler.html` sayfasındadır; bu düzenleme tek başına tüm hukuki yükümlülüklerin tamamlandığı iddiası değildir.

## Yetkiler ve Sayman

Yeni yetkiler ayrı seçilir:

- `payments.view` / `payments.manage`: ödeme bilgisi ve kontrolü.
- `statistics.view`: etkinlik ve dönem istatistikleri.
- `audit.view`: etkinlik işlem geçmişi.
- `yearbooks.view` / `yearbooks.manage` / `yearbooks.publish`: yıllık görüntüleme, taslak düzenleme ve yayımlama.

Ödeme kontrolü kayıtların içindedir; yeni ödeme yetkisi verirken **Kayıtları görüntüle** izni de baş yönetici tarafından ayrıca seçilmelidir. Panel ve sunucu eksik birleşimi reddeder; katılımcı bilgilerine erişim sessizce eklenmez.

Mevcut normal yetkili hesaplara yeni izinler otomatik verilmez. Baş yönetici tümüne erişir. Sayman sabit salt okunur olarak kayıtları, ödeme durumlarını ve kaldırılmamış eski dekontları görür; ödeme onaylayamaz. Eski sabit Sayman hesabına geçiş ETag ile yapılır, şifresi/aktifliği korunur ve eski oturumu geçersiz olur. Yönetici hesapları bölümü veya başarılı Sayman girişi bu geçişi tamamlar.

## İstatistikler ve etkinlik denetimi

**İstatistikler** bölümünde etkinlik, başlangıç ve bitiş tarihini seçin. Toplam başvuru/asıl/yedek/iptal, gerçek QR ve elle kapı girişi, asıl doluluk oranı gösterilir. Rakamlar kayıt veya bilet girişi sayısıdır; dönem boyunca benzersiz insan sayısı değildir.

Biletini hesabına eklemek kapı girişi değildir. Eski kapı verisi eksik veya doğrulanamıyorsa sayı `—` gösterilir. Eksik verisi olan dönem toplamları tam sayım gibi sunulmaz; kapsam açıklanır. Gelmeyenler yalnızca giriş takibi tamamlanmış, başlamış etkinlikte asıl başvurunun kesin bilet eşleşmesi üzerinden hesaplanır. `attendance.manage` yetkisi olan yönetici etkinliğin giriş takibini tamamlandı olarak işaretleyebilir veya yeniden açabilir. Bu işaret eski girişleri üretmez ve kapı taramasını durdurmaz.

**Etkinlik denetimi** bölümünde etkinlik, işlem türü ve tarih filtreleri bulunur. Etkinlik oluşturma/düzenleme/yayın durumu, form erişimi, kontenjan/sayaç değişiklikleri, iptal/yükseltme ve ödeme kontrolü gibi yeni işlemler kaydedilir. Yetkili kimliği kayıtlıysa gösterilir. Telefon, cevap, dekont ve QR sırrı denetime kopyalanmaz. Önceden tutulmamış işlem veya yönetici bilgisi uydurulmaz. Geçmiş arka planda sessizce son 20 işleme düşürülmez; büyük geçmişin arşivlenmesi gerekirse veri kaybı yerine işlem durdurulur.

## ERCUPSA Yıllıkları

**Yıllıklar** bölümünde `2026-2027` gibi dönemi oluşturun. Yıllık kendiliğinden yayımlanmaz; Haziran 2027 için otomatik zamanlayıcı yoktur. Başlık/açıklama, dönem tarihleri, seçilmiş etkinliklerin sırası ve bölümleri, özel mesajlar, yönetim kurulu fotoğrafı, başkanın mesajı ve teşekkür metni düzenlenebilir.

Etkinliğin mevcut fotoğraf bağlantılarından seçim yapılır. Seçilen her fotoğrafın yayın uygunluğu ayrı doğrulanmalıdır; eski galeride bulunması kişisel yayın izni yerine geçmez. Galeri kayıtları ve Cloudinary dosyaları değiştirilmez. Yönetim kurulu fotoğrafı mevcut galeri görsellerinden ayrıca seçilebilir.

**Taslağı kaydet** ve **Önizleme** herkese yayın yapmaz. Önizleme yalnızca yetkili oturumla, önbelleksiz açılır. Yayımlama yetkisiyle **Yayımla** denince etkinlik bilgileri, seçilen fotoğraflar ve doğrulanmış istatistikler kalıcı bir yayın kopyasına alınır. Olmayan veri yerine sayı üretilmez. Gelecekteki etkinlikler yıllığa yayımlanamaz. Aynı günün henüz başlamamış etkinliği veya saati bilinmeyen aynı gün etkinliği de yayımlanmaz; saati bilinmiyorsa ertesi gün beklenir. Taslağın sonradan düzenlenmesi veya yeni dönem verileri mevcut yayın kopyasını değiştirmez; güncellemek için açıkça yeniden yayımlamak gerekir. **Yayından kaldır** yayın erişimini kapatır, taslağı veya önceki kopyayı silmez.

Arşiv `yilliklar.html`, dönem sayfası `yillik.html?donem=2026-2027` veya `/yillik/2026-2027` üzerinden açılır. Ana sayfanın yıllık duyurusu yalnızca yayımlanmış yıllık varsa görünür. Yeni dönemler ayrı kayıt ve yayın kopyası olarak saklanır. Yıllık görselleri mevcut Cloudinary bağlantılarını kullanır; arşivin görsellerinin kalması için bu kaynak dosyalar ayrıca korunmalıdır. Hareket azaltma tercihi desteklenir; video oluşturulmaz.

## Dağıtım ve geri dönüş kontrolü

1. Üretimden bağımsız ortamda `npm run build`, `npm test` ve Netlify Dev açıkken `npm run test:browser` çalıştırın.
2. Mevcut etkinlik/form/bilet/özel dosya depolarının yetkili yedeğini koruyun. Bu geliştirmede üretim yedeği veya üretim mutasyonu çalıştırılmaz.
3. Yeni sürümde eski bir formun varsayılan olarak yedeksiz/sayaçsız açıldığını, eski bilet ve özel dosyaların erişimini doğrulayın.
4. Yeni ücretli/yedek bir deneme formunda eşzamanlı kontenjan, iptal/yükseltme, ödeme onayı ve bilet uygunluğunu doğrulayın.
5. Yetkisiz hesapların yeni özel uçlara erişemediğini, taslak yıllığın public listede ve doğrudan bağlantıda görünmediğini kontrol edin.
6. `galeri.html`, `assets/gallery.css`, `assets/galeri-inline-*.js`, `style.css`, `fun.js` ve `assets/shell.js` bu değişiklikte korunur. Galeri arama, filtre ve fotoğraf görüntülemeyi doğrulayın.

Geri dönmek gerekirse önce ilgili formları kapatıp veri kopyasını koruyun. Yeni yedek/ödeme durumlarını tanımayan eski bir sürümü açık kayıt alırken doğrudan devreye sokmayın. Veri dosyalarını silerek veya eski toplu kopyayı üzerlerine yazarak geri dönüş yapılmamalıdır; galeri, bilet, başvuru ve giriş geçmişi korunmalıdır.
