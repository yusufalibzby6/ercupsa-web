# ERCUPSA Yönetim Sistemi

Bu sürüm, Netlify üzerinde çalışan küçük bir içerik yönetim sistemi ekler.

## Kurulum
1. Projeyi Netlify'a deploy edin.
2. Netlify'da `Project configuration > Environment variables` bölümünden `ADMIN_PASSWORD` değişkenini güçlü, yalnızca baş yöneticinin bildiği bir parola olarak ayarlayın. Önceden ortak kullanılan parolayı bu sürümü yayımlamadan önce değiştirin.
3. Cloudinary hesabı açın ve `Settings > Upload presets` altında bir **unsigned** upload preset oluşturun. Allowed formats: jpg, jpeg, png, webp; makul bir max file size belirleyin.
4. `assets/admin.js` içindeki görsel yükleme ayarlarının `cloudName` ve `uploadPreset` değerlerini kendi bilgilerinizle değiştirin.
5. Tekrar deploy edin.
6. `https://ercupsa.com.tr/admin.html` adresinden **basadmin** kullanıcı adı ve `ADMIN_PASSWORD` parolasıyla giriş yapın. İsterseniz `ADMIN_USERNAME` ortam değişkeniyle baş yönetici kullanıcı adını değiştirebilirsiniz; varsayılan `basadmin` için yeni değişken gerekmez.

## Nasıl çalışır?
- Etkinlik bilgileri Netlify Blobs'ta saklanır.
- Fotoğraflar Cloudinary'ye toplu yüklenir.
- Etkinlik adı yalnızca bir kez girilir; fotoğraflar aynı etkinliğe bağlanır.
- Tarihi geçmiş etkinlikler otomatik olarak "Geçmiş Etkinlikler" bölümüne taşınır.
- Galeri sayfası etkinliklerdeki fotoğrafları otomatik gösterir.

## Güvenlik
`ADMIN_PASSWORD` sadece Netlify environment variable olarak tutulur. Cloudinary API secret kesinlikle frontend'e koyulmaz. Cloudinary unsigned preset'inizi sadece görsel yüklemeye izin verecek şekilde sınırlandırın.

## Baş yönetici, Sayman ve yetkili hesaplar

Baş yönetici **Yönetici hesapları** bölümünden ayrı kullanıcı adı ve şifreyle hesap oluşturur. Her hesapta bölüm görüntüleme ve işlem yetkilerini ayrı seçebilir: örneğin yalnızca **Etkinlikler** ve **Instagram**, bu bölümlerde de görüntüleme veya düzenleme. **Etkinliğin yayın durumunu değiştirme** ayrıca seçilir. Düzenleme yetkisi baş yönetici yetkisi vermez.

**Sayman** hesabı `sayman` kullanıcı adıyla hazır gelir. İlk kez bu bölümü açınca özel depoda oluşturulur; başlangıçta pasiftir ve varsayılan şifresi yoktur. **Düzenle** ile en az 12 karakterlik bir şifre belirleyip etkinleştirin. Sabit yetkileri kayıt listesini ve dekontları görüntülemektir. Form hazırlama, kayıt silme, fotoğraf görüntüleme, CSV indirme ve bilet işlemleri yapamaz. Saymanın adı, şifresi ve aktifliği değiştirilebilir; sabit yetkileri ve kullanıcı adı değişmez. Diğer hesapların bölüm/işlem yetkileri düzenlenebilir.

Etkinlik silme, silinen etkinliklere erişme/geri alma/kalıcı silme, girilmiş kayıtları silme, yönetici hesapları ve kapı görevlisi hesaplarını yönetme yalnızca baş yöneticiye açıktır. Sunucu bu sınırları her istekte kontrol eder; görünmeyen bir düğmenin API adresini kullanmak yetki vermez.

Diğer yöneticilerin şifreleri rastgele tuzla scrypt kullanılarak özetlenir ve ekranda geri gösterilmez. Şifre, yetki, kullanıcı adı veya aktiflik değişikliği o hesabın açık oturumlarını geçersiz kılar. Çıkış, ilgili yetkili hesabın oturum belirtecini de iptal eder. Çerezler HttpOnly, SameSite=Strict ve HTTPS'te Secure'dür; oturum süresi sekiz saattir. Girişlerde hem IP hem kullanıcı/IP sınırı uygulanır. Bu sürümden önceki yönetici çerezleri kabul edilmez. Baş yönetici parolasını değiştirmek bütün yönetici/görevli imzalarını geçersiz kılar; parola Netlify'da güncellendikten sonra yeniden yayımlayın.

Yönetici hesapları özel Netlify Blobs deposunda saklanır. Yeni SQL veya zorunlu ortam değişkeni gerekmez. Baş yöneticinin parolasını diğer yöneticilerle paylaşmayın; onların kendi hesaplarını kullanmalarını sağlayın. Kapıdaki **Görevli hesabı** ile paneldeki **Yönetici hesabı** ayrı yetkilerdir.

## Panel bölümleri

Baş yönetici panelinde **Etkinlikler**, **Kayıt formları**, **Biletler**, **Çekilişler**, **Giriş ve görevliler**, **Kullanıcılar**, **Instagram** ve **Yönetici hesapları** bölümleri bulunur. Diğer hesaplar yalnızca izin verilen bölümleri görür. Geniş ekranda soldaki menüden, telefonda üstteki menüden geçiş yapılır. Öneriler, deneyimler ve değerlendirmeler sekmeleri kaldırılmıştır.

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

Baş yönetici çöp kutusunda **Kalıcı sil** düğmesine basıp etkinliğin adını tam olarak yazarak saklanan etkinlik kopyasını da silebilir. Bu işlem form cevaplarını, dekontları ve biletleri topluca silmez; kayıtlar kendi arşivinde korunur. Etkinliğin yeniden belirmesini engellemek için kimlik ve silme işareti saklanır. Kalıcı silinen etkinlik panelden geri getirilemez; eski bir form kopyasından otomatik kurtarma da kapatılır.

Panel, etkinliği açtığınız sürüm değişmişse eski düzenlemeyle üzerine yazmayı reddeder. Yayınlama düğmesi yalnızca yayın durumunu değiştirir. Yeni etkinlik işlemleri zaman damgası ve işlemi yapan hesabın kimliği/kullanıcı adıyla kayda geçer. Bu özellik eklenmeden önceki silme işlemlerini kimin yaptığı geriye dönük belirlenemez.

Yetkisiz yönetici erişiminden şüpheleniyorsanız Netlify **Project configuration → Environment variables → ADMIN_PASSWORD** değerini güçlü, yeni bir parola ile değiştirin ve yeniden yayımlayın. Yeni parola sunucuda devreye girdiğinde önceki yönetici çerezleri de geçersiz olur. Parolayı yalnızca yetkili yöneticilerle paylaşın; sohbet veya GitHub dosyalarına yazmayın.
