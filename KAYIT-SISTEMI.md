# Etkinlik kayıt sistemi

Katılımcılar site hesabı açmadan etkinliğin kendi formunu doldurabilir. Birden fazla etkinliğin formu aynı anda açık olabilir. Formlar, cevaplar ve dekontlar Netlify Blobs'ta saklanır; bu özellik için yeni ortam değişkeni veya Supabase kurulumu gerekmez.

## Form hazırlama

1. Yönetim panelinin **Etkinlikler** bölümünden etkinliği oluşturun.
2. Etkinlik kartındaki **Kayıt formu** düğmesine veya üstteki **Kayıt formları** sekmesine girin ve etkinliği seçin.
3. **Formun üst açıklaması** alanına katılımcının görmesini istediğiniz açıklamayı, ücret ve ödeme bilgilerini yazın. Açıklama formun üstünde görünür; satır sonları korunur.
4. Ad soyad, sınıf ve telefon alanları hazır gelir. Ad soyad her zaman zorunludur; sınıf ve telefonun zorunluluğunu değiştirebilirsiniz. Sınıf seçeneklerini de düzenleyebilirsiniz.
5. **Soru ekle** ile kısa/uzun cevap, e-posta, telefon, açılır liste, tek seçim veya çoklu seçim soruları ekleyin. Sorunun başlığını, seçeneklerini ve zorunluluğunu belirleyin. Temel alanlarla birlikte en fazla 25 soru olabilir.
6. İsterseniz dekont yüklemeyi açın ve zorunlu yapın. PNG, JPEG veya PDF dosyaları kabul edilir; sınır 4 MB'dir. Dekontlar herkese açık görsel bağlantısına dönüştürülmez.
7. **Kayıt üst sınırı** alanına örneğin `40` yazın. Toplam kayıt sayısı bu sınıra ulaştığında form otomatik kapanır. Sınır istemiyorsanız alanı boş bırakın. Önceden alınmış kayıtlar da toplam sayıya dahildir.
8. **Kayıt formunu erişime aç** seçeneğini işaretleyip **Formu kaydet** düğmesine basın. Etkinliği de yayımlayın. Etkinlik kartındaki **Kayıt linkini kopyala** düğmesi paylaşabileceğiniz bağlantıyı verir.

Bağlantı `form.html?event=ETKINLIK_KIMLIGI#registrationSection` biçimindedir. Katılımcı doğrudan o etkinliğin formuna ulaşır; formun önünde büyük bir afiş bulunmaz. Formlar sayfası açık olan tüm etkinlikleri listeler.

Form erişimini kapatmak mevcut kayıtları silmez. Türkiye tarihine göre günü geçmiş etkinlikler yeni kayıt almaz; aynı gün etkinlik başlangıç saatinin geçmesi formu kendiliğinden kapatmaz.

Kontenjan dolduğunda katılımcı şu mesajı görür: **“İlginiz için teşekkür ederiz. Kontenjanımız dolmuştur. Bir sonraki etkinliklerimize bekleriz.”** Her kayıt bir yer kullanır. Aynı anda gelen başvurular da sınırı aşamaz; aynı gönderimin tekrar denenmesi yeni bir yer kullanmaz. Mevcut kayıt sayısından daha düşük bir sınır belirlerseniz eski kayıtlar korunur, yeni kayıt alınmaz. Sınırı yükseltmek veya boş bırakmak formun diğer erişim koşulları uygunsa tekrar açılmasını sağlar.

Kaydedilmemiş form değişiklikleri etkinlikler arasında geçiş yaparken korunur. Sayfayı kapatmadan önce kaydedin. Soruları sonradan değiştirseniz de eski kayıtların soru başlıkları ve cevapları korunur.

## Kayıtları inceleme

**Kayıt formları** sekmesinde seçilen etkinliğin toplam kayıt sayısını, üst sınırını ve sınıf dağılımını görebilirsiniz. İsim, telefon ve cevaplarda arama yapabilir; sınıfa göre filtreleyebilirsiniz. Kayıtların ayrıca onaylanması veya reddedilmesi gerekmez. Önceki sürümdeki onay/red durumları kayıt sayımını etkilemez.

**Cevapları göster** tüm cevapları açar. **Dekontu görüntüle** dosyayı yalnızca yönetici oturumuyla getirir. Yanlış veya gereksiz bir başvuruyu **Kaydı sil** düğmesine basıp işlemi doğrulayarak kaldırabilirsiniz. Silinen kaydın dekontuna erişim de kaldırılır. Silme toplam kayıt sayısını azaltır; form erişime açıksa ve etkinliğin günü geçmediyse boşalan yer için tekrar kayıt alınabilir. **CSV indir** filtrelerden bağımsız olarak etkinliğin tüm mevcut kayıtlarını indirir.

**Etkinlikleri karşılaştır** bölümünde istediğiniz etkinlikleri seçerek kayıt sayılarını ve sınıflara göre dağılımı yan yana görebilirsiniz. Bunlar form kayıt sayılarıdır. Etkinliğe fiilen gelen kişiler ve QR bilet katılımları ayrı tutulur; form göndermek bilet oluşturmaz.

## Mevcut Google Forms bağlantıları

Henüz site içi form kaydetmediğiniz etkinlikler mevcut Google Forms bağlantılarını kullanmaya devam eder. Bir etkinliğe site içi form kaydettiğinizde kayıt akışı bu forma geçer. Site içi formu kapatırsanız eski Google Forms bağlantısı otomatik açılmaz. Google Forms'taki eski cevaplar bu panele aktarılmaz.

## Yayımlama ve doğrulama

GitHub değişikliklerini Netlify üzerinden yayımlamak yeterlidir. Mevcut `ADMIN_PASSWORD` yönetici oturumu için kullanılır. Dekontlara, kayıt listelerine ve CSV dosyalarına erişim sunucuda yönetici oturumuyla korunur; herkese açık etkinlik API'sinde kayıt sayıları ve kişisel bilgiler bulunmaz.

Yerel doğrulama için `npm ci`, `npm run build`, `npm test` ve Netlify Dev açıkken `npm run test:browser` kullanılabilir. Kayıt testleri üretim verilerine yazmadan çalışır.
