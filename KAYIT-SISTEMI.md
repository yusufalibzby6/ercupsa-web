# Etkinlik kayıt sistemi

Katılımcılar site hesabı açmadan etkinliğin kendi formunu doldurabilir. Birden fazla etkinliğin formu aynı anda açık olabilir. Formlar, cevaplar ve dekontlar Netlify Blobs'ta saklanır; bu özellik için yeni ortam değişkeni veya Supabase kurulumu gerekmez.

## Form hazırlama

1. Yönetim panelinin **Etkinlikler** bölümünden etkinliği oluşturun.
2. Etkinlik kartındaki **Kayıt formu** düğmesine veya üstteki **Kayıt formları** sekmesine girin ve etkinliği seçin.
3. **Formun üst açıklaması** alanına katılımcının görmesini istediğiniz açıklamayı, ücret ve ödeme bilgilerini yazın. Açıklama formun üstünde görünür; satır sonları korunur.
4. Ad soyad, sınıf ve telefon alanları hazır gelir. Ad soyad her zaman zorunludur; sınıf ve telefonun zorunluluğunu değiştirebilirsiniz. Sınıf seçeneklerini de düzenleyebilirsiniz.
5. **Soru ekle** ile kısa/uzun cevap, e-posta, telefon, açılır liste, tek seçim, çoklu seçim veya **Fotoğraf yükleme** soruları ekleyin. Sorunun başlığını, seçeneklerini ve zorunluluğunu belirleyin. Temel alanlarla birlikte en fazla 25 soru olabilir.
6. İsterseniz dekont yüklemeyi açın ve zorunlu yapın. PNG, JPEG veya PDF dekontları kabul edilir. Fotoğraflar ve dekontun toplam dosya boyutu en fazla **4 MB** olabilir; tek başına dekontun sınırı da 4 MB'dir. Dosya türü gerçek içeriğinden belirlenir; telefonun farklı tür veya uzantı bildirmesi geçerli dekontun reddedilmesine yol açmaz. Gönderilen dosyalar herkese açık bağlantılara dönüştürülmez.
7. **Kayıt üst sınırı** alanına örneğin `40` yazın. Toplam kayıt sayısı bu sınıra ulaştığında form otomatik kapanır. Sınır istemiyorsanız alanı boş bırakın. Önceden alınmış kayıtlar da toplam sayıya dahildir.
8. **Kayıt formunu erişime aç** seçeneğini işaretleyip **Formu kaydet** düğmesine basın. Etkinlik yayımlanmamış olsa da kendi kayıt bağlantısı çalışır. Etkinlik kartındaki **Kayıt linkini kopyala** düğmesi paylaşabileceğiniz bağlantıyı verir.

Etkinliğin yayın durumu ile formun açık/kapalı durumu ayrıdır. **Yayından kaldır**, etkinliği genel etkinlik ve form listelerinden gizler; açık formun doğrudan bağlantısını kapatmaz. Kayıt almayı durdurmak için **Kayıt formunu erişime aç** işaretini kaldırıp kaydedin. Kontenjanı dolan, geçmiş günlerde kalan veya silinen etkinliğin formu yeni kayıt almaz. Kapalı bir taslak etkinliğin bilgileri doğrudan bağlantıyla açıklanmaz.

Bağlantı `form.html?event=ETKINLIK_KIMLIGI#registrationSection` biçimindedir. Katılımcı doğrudan o etkinliğin formuna ulaşır; formun önünde büyük bir afiş bulunmaz. Formlar sayfası açık olan tüm etkinlikleri listeler.

Form erişimini kapatmak mevcut kayıtları silmez. Türkiye tarihine göre günü geçmiş etkinlikler yeni kayıt almaz; aynı gün etkinlik başlangıç saatinin geçmesi formu kendiliğinden kapatmaz.

Kontenjan dolduğunda katılımcı şu mesajı görür: **“İlginiz için teşekkür ederiz. Kontenjanımız dolmuştur. Bir sonraki etkinliklerimize bekleriz.”** Her kayıt bir yer kullanır. Aynı anda gelen başvurular da sınırı aşamaz; aynı gönderimin tekrar denenmesi yeni bir yer kullanmaz. Mevcut kayıt sayısından daha düşük bir sınır belirlerseniz eski kayıtlar korunur, yeni kayıt alınmaz. Sınırı yükseltmek veya boş bırakmak formun diğer erişim koşulları uygunsa tekrar açılmasını sağlar.

Kaydedilmemiş form değişiklikleri etkinlikler arasında geçiş yaparken korunur. Sayfayı kapatmadan önce kaydedin. Soruları sonradan değiştirseniz de eski kayıtların soru başlıkları ve cevapları korunur.

## Fotoğraflı seçenekler ve fotoğraf cevapları

**Açılır liste**, **Tek seçim** ve **Çoklu seçim** sorularında her seçeneğin adını kendi satırında düzenleyebilirsiniz. Satırdaki **Fotoğraf ekle** düğmesiyle o seçeneğe görsel yükleyin. Görseli değiştirebilir veya kaldırabilir, seçenekleri yukarı/aşağı taşıyabilir ve yeni seçenek ekleyebilirsiniz. Fotoğraf ile adı aynı seçeneğe bağlı kalır. Formu kaydedince katılımcılar fotoğrafı ve seçeneğin adını birlikte görür. Görsel içeren açılır liste soruları tek seçim yapılabilen kartlar olarak gösterilir; görsel eklenmeyen eski açılır listeler normal görünümünü korur.

Katılımcının kendi fotoğrafını göndermesi için ayrı bir soru ekleyip cevap türünü **Fotoğraf yükleme** seçin. Başlığı örneğin “Çalışmanızın fotoğrafını gönderin” olarak değiştirin ve gerekiyorsa **Zorunlu alan**ı açın. Bu soru dekont alanından bağımsızdır. JPEG, PNG ve WebP fotoğrafları desteklenir; PDF yalnızca dekont alanında kullanılabilir. Tüm fotoğraflar ve dekont birlikte en fazla 4 MB olmalıdır.

Gönderilen fotoğrafları kayıtların cevapları bölümündeki **Fotoğrafı görüntüle** düğmesinden açabilirsiniz. Yalnızca fotoğraf görüntüleme yetkisi olan yönetici oturumuyla erişilir; CSV'ye dosya adı yazılır, özel dosyanın bağlantısı eklenmez. Kaydı yalnızca baş yönetici silebilir; silmek o kayda bağlı fotoğraflara ve dekonta erişimi de kaldırır. Katılımcının başarı özetinde fotoğraflar veya özel cevaplar bulunmaz. Sayman kayıtları ve dekontları inceler; formu değiştiremez, fotoğraf/CSV/bilet işlemi veya kayıt silme yapamaz.

## Kayıtları inceleme

**Kayıt formları** sekmesinde seçilen etkinliğin toplam kayıt sayısını, üst sınırını ve sınıf dağılımını görebilirsiniz. İsim, telefon ve cevaplarda arama yapabilir; sınıfa göre filtreleyebilirsiniz. Kayıtların ayrıca onaylanması veya reddedilmesi gerekmez. Önceki sürümdeki onay/red durumları kayıt sayımını etkilemez.

**Cevapları göster** tüm cevapları açar. **Dekontu görüntüle** dosyayı yalnızca yönetici oturumuyla getirir. Yanlış veya gereksiz bir başvuruyu **Kaydı sil** düğmesine basıp işlemi doğrulayarak kaldırabilirsiniz. Silinen kaydın dekontuna erişim de kaldırılır. Silme toplam kayıt sayısını azaltır; form erişime açıksa ve etkinliğin günü geçmediyse boşalan yer için tekrar kayıt alınabilir. **CSV indir** filtrelerden bağımsız olarak etkinliğin tüm mevcut kayıtlarını indirir.

**Etkinlikleri karşılaştır** bölümünde istediğiniz etkinlikleri seçerek kayıt sayılarını ve sınıflara göre dağılımı yan yana görebilirsiniz. Bunlar form kayıt sayılarıdır. Etkinliğe fiilen gelen kişiler ve QR bilet katılımları ayrı tutulur; form göndermek bilet oluşturmaz.

Aynı etkinlikte aynı telefonla gönderilmiş başvurular **Olası tekrar kayıtlar** filtresiyle bulunur. Bu bir uyarıdır; ortak telefon kullanan katılımcılar otomatik engellenmez. Cevapları karşılaştırıp gereksiz kaydı silebilirsiniz. **Bilet verilmemiş / Bilet verilmiş** filtreleri de kayıtların bilet durumunu gösterir.

**Etkinlik listesi → Arşiv** ile silinen etkinliklerin korunmuş cevaplarını, dekontlarını ve verilmiş biletlerini açabilirsiniz. Karşılaştırma tablosundaki **Kayıtları aç** düğmesi de ilgili etkinliğe gider. Arşivde form düzenleme ve yeni bilet verme kapalıdır; CSV indirme ve kayıt silme kullanılabilir.

## Form kaydından QR bileti verme

Katılımcının kaydında **Bilet ver** düğmesine basın. O kayda özel tek bir QR bileti hazırlanır. Etkinliğin özel bilet tasarımı varsa aynı tasarım kullanılır. **Bağlantıyı kopyala** ile katılımcıya iletebilir veya **Bileti yazdır / PDF kaydet** ile çıktı alabilirsiniz. Sonraki **Bileti görüntüle** işlemi aynı bileti açar; bağlantı kesildiğinde yeniden denemek ek bilet oluşturmaz. Bilet bağlantısını yalnızca sahibine iletin.

Bu işlem bilet oluşturur; katılımcının hesabına kendiliğinden eklemez. Katılımcı QR’ı okutur, giriş yapar veya hesap oluşturur, ardından **Katılımımı ekle** düğmesine basar. Hazır QR kodu varsa bu adım mobil sayfanın üstünde gösterilir. Kapıda görevli aynı bileti ayrıca okutur. Panelde **Hesaba eklendi** ve **Kapıda giriş yaptı** durumları ayrı gösterilir.

Form kaydını silmek o kayıttan verilmiş QR biletini de iptal eder. Daha önceki hesap katılımı, kapı giriş geçmişi ve çekiliş sonuçları bu işlemle silinmez. İptal sırasında bağlantı hatası olursa **Bilet iptali tamamlanmayı bekliyor** satırı kalır; **Bilet iptalini tamamla** ile aynı işlem yeniden denenir.

## Katılımcı kayıt özeti ve paylaşım

Başarılı form gönderiminden sonra etkinlik bilgileri ve kayıt referansı gösterilir. Katılımcı özeti kopyalayabilir veya metin dosyası olarak indirebilir. Özet bir QR bileti değildir; dekont ve form cevapları özete eklenmez.

Etkinlikteki **Paylaş** veya paneldeki **Etkinliği paylaş** düğmesi `https://ercupsa.com.tr/etkinlik/ETKINLIK_KIMLIGI` bağlantısını kullanır. WhatsApp gibi uygulamalar etkinliğin kendi afişini, adını ve tarihini görür. Açılan kartın düğmesi doğrudan kayıt formuna götürür. Paneldeki doğrudan **Kayıt linkini kopyala** bağlantısı da korunur.

Etkinlik düzenleyicisinde kaydedilmemiş taslaklar aynı tarayıcı sekmesinde etkinlikler arasında geçişte ve yenilemede korunur. **Kaydedilmiş etkinliğe dön** veya **Yeni taslağı sil** ile değişiklikleri kaldırabilirsiniz. Yönetici çıkışı taslakları temizler.

## Mevcut Google Forms bağlantıları

Henüz site içi form kaydetmediğiniz etkinlikler mevcut Google Forms bağlantılarını kullanmaya devam eder. Bir etkinliğe site içi form kaydettiğinizde kayıt akışı bu forma geçer. Site içi formu kapatırsanız eski Google Forms bağlantısı otomatik açılmaz. Google Forms'taki eski cevaplar bu panele aktarılmaz.

## Yayımlama ve doğrulama

GitHub değişikliklerini Netlify üzerinden yayımlamak yeterlidir. Mevcut `ADMIN_PASSWORD` yönetici oturumu için kullanılır. Dekontlara, kayıt listelerine ve CSV dosyalarına erişim sunucuda yönetici oturumuyla korunur; herkese açık etkinlik API'sinde kayıt sayıları ve kişisel bilgiler bulunmaz.

Form kaydından bilet verme mevcut Supabase `create_ticket_batch` işlevini ve bilet tablolarını kullanır. Yeni SQL migration veya ortam değişkeni gerekmez.

Yerel doğrulama için `npm ci`, `npm run build`, `npm test` ve Netlify Dev açıkken `npm run test:browser` kullanılabilir. Kayıt testleri üretim verilerine yazmadan çalışır.
