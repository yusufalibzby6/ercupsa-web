# ERCUPSA Yönetim Sistemi

Bu sürüm, Netlify üzerinde çalışan küçük bir içerik yönetim sistemi ekler.

## Kurulum
1. Projeyi Netlify'a deploy edin.
2. Netlify'da `Project configuration > Environment variables` bölümünden `ADMIN_PASSWORD` değişkenini ekleyin.
3. Cloudinary hesabı açın ve `Settings > Upload presets` altında bir **unsigned** upload preset oluşturun. Allowed formats: jpg, jpeg, png, webp; makul bir max file size belirleyin.
4. `assets/admin.js` içindeki görsel yükleme ayarlarının `cloudName` ve `uploadPreset` değerlerini kendi bilgilerinizle değiştirin.
5. Tekrar deploy edin.
6. `https://ercupsa.com.tr/admin.html` adresinden yönetim panelini açın.

## Nasıl çalışır?
- Etkinlik bilgileri Netlify Blobs'ta saklanır.
- Fotoğraflar Cloudinary'ye toplu yüklenir.
- Etkinlik adı yalnızca bir kez girilir; fotoğraflar aynı etkinliğe bağlanır.
- Tarihi geçmiş etkinlikler otomatik olarak "Geçmiş Etkinlikler" bölümüne taşınır.
- Galeri sayfası etkinliklerdeki fotoğrafları otomatik gösterir.

## Güvenlik
`ADMIN_PASSWORD` sadece Netlify environment variable olarak tutulur. Cloudinary API secret kesinlikle frontend'e koyulmaz. Cloudinary unsigned preset'inizi sadece görsel yüklemeye izin verecek şekilde sınırlandırın.

## Panel bölümleri

Panelde **Etkinlikler**, **Kayıt formları**, **Biletler**, **Çekilişler**, **Giriş ve görevliler**, **Kullanıcılar** ve **Instagram** bölümleri bulunur. Geniş ekranda soldaki menüden, telefonda üstteki menüden geçiş yapılır. Öneriler, deneyimler ve değerlendirmeler sekmeleri kaldırılmıştır.

Hesaplar ve QR bilet kurulumu için [SUPABASE-KURULUM.md](SUPABASE-KURULUM.md), kapı girişleri için [ETKINLIK-GIRIS.md](ETKINLIK-GIRIS.md), çekiliş kuralları için [CEKILISLER.md](CEKILISLER.md) belgesini izleyin. Yönetici parolası tarayıcı depolamasında tutulmaz. `npm ci`, `npm run build` ve `npm test` kullanılabilir.

## Site kullanıcıları ve ad görünürlüğü

**Kullanıcılar** sekmesinde siteye kayıt olan hesapların ad soyad ve e-posta bilgileri listelenir; ad veya e-posta ile arayıp sayfalar arasında ilerleyebilirsiniz. Henüz profil bilgilerini tamamlamamış hesaplar da görünür. Bir isme basınca açılan pencerede biletini hesabına eklediği etkinlikler ve kapıda doğrulanmış girişleri ayrı gösterilir. Bileti hesaba eklemek, etkinliğe gerçekten giriş yapmak anlamına gelmez. Kapı kayıtları okunamazsa giriş durumu doğrulanamadı olarak gösterilir.

**Sitedeki adı gizle**, kişinin adının herkese açık katılım listelerinde gösterilmesini engeller. Hesabı, e-postası, biletleri, çekiliş hakları ve etkinlik geçmişi silinmez. Kullanıcı profilinde izin verse bile yönetici engeli devam eder. **Yönetici engelini kaldır** yalnızca bu engeli kaldırır; kişinin kendi görünürlük iznini değiştirmez. İzin vermemiş kullanıcıların adı gizli kalır. Bu ekran e-posta veya etkinlik geçmişini herkese açık hâle getirmez. Yönetici çıkışında liste ve açık pencerenin bilgileri temizlenir.

## Ana sayfanın Instagram paylaşımları

**Instagram** sekmesindeki dört alana paylaşım veya Reels bağlantılarını yapıştırın ve **4 paylaşımı kaydet** düğmesine basın. Alanların sırası ana sayfadaki kartların sırasıdır; eski bağlantının yerine yenisini kaydederek o kartı değiştirebilirsiniz. Instagram hesabına giriş veya API anahtarı gerekmez.

Yalnızca `https://www.instagram.com/p/.../` ve `https://www.instagram.com/reel/.../` biçimindeki paylaşım bağlantıları kabul edilir. İzleme parametreleri temizlenir. Ana sayfa kaydedilmiş dört bağlantıyı kullanır; Instagram gömme içeriği yüklenemezse paylaşımı Instagram'da açabileceğiniz bağlantı görünür. Bu ayar Netlify Blobs'ta saklanır; yeni SQL kurulumu veya ortam değişkeni gerekmez.

## Etkinlik kayıt formları

Site içi form hazırlama, sınıf ve telefon alanları, zorunlu sorular, özel dekontlar ve etkinlik karşılaştırması için [KAYIT-SISTEMI.md](KAYIT-SISTEMI.md) belgesini izleyin. Bu özellik mevcut Netlify kurulumuyla çalışır.

## Silinen etkinlikleri geri alma

**Etkinlikler → Silinen etkinlikler** bölümünden etkinliği **Taslak olarak geri al** düğmesiyle kurtarın. Etkinlik eski kimliğiyle geri döner; mevcut form bağlantıları, başvurular ve biletler aynı etkinliğe bağlı kalır. Bilgilerini kontrol ettikten sonra yayımlayın.

Bu sürümden sonra silinen etkinliklerin afişi, açıklaması ve diğer bilgileri geri almak için korunur. Silme, etkinliği siteden ve normal panel listesinden kaldırır; kayıtlarını ve biletlerini silmez. Geri alma işlemi otomatik yayımlama yapmaz.

Önceki sürümlerde kalıcı silinmiş etkinlikler için kayıt formunda korunan başlık, tarih, saat ve konumdan bir taslak kurtarılabilir. Afiş, kategori, açıklama ve galeri bu eski kopyada bulunmaz; geri aldıktan sonra düzenleyin. Kayıt formunda kullanılabilir bir etkinlik kopyası yoksa bu yöntemle kurtarma yapılamaz. Yeni bir etkinlik oluşturmak farklı bir kimlik üretir ve eski bağlantıları geri getirmez. GitHub veya Netlify dağıtımını eski sürüme döndürmek, Blobs'taki silinmiş içeriği geri getirmez.

Panel, etkinliği açtığınız sürüm değişmişse eski düzenlemeyle üzerine yazmayı reddeder. Yayınlama düğmesi yalnızca yayın durumunu değiştirir. Yeni silme ve geri alma işlemleri zaman damgasıyla kayda geçer; bu kayıtlar önceki silme işlemini kimin yaptığını göstermez. Panel ortak yönetici parolası kullandığı için kişi bazında kimlik tespiti yapılmaz.

Yetkisiz yönetici erişiminden şüpheleniyorsanız Netlify **Project configuration → Environment variables → ADMIN_PASSWORD** değerini güçlü, yeni bir parola ile değiştirin ve yeniden yayımlayın. Yeni parola sunucuda devreye girdiğinde önceki yönetici çerezleri de geçersiz olur. Parolayı yalnızca yetkili yöneticilerle paylaşın; sohbet veya GitHub dosyalarına yazmayın.
