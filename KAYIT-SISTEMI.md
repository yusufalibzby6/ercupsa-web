# Etkinlik kayıt sistemi

Katılımcılar site hesabı açmadan etkinliğin kendi formunu doldurabilir. Birden fazla etkinliğin formu aynı anda açık olabilir. Formlar, cevaplar ve özel fotoğraf cevapları Netlify Blobs'ta saklanır; bu özellik için yeni ortam değişkeni veya Supabase kurulumu gerekmez.

## Form hazırlama

1. Yönetim panelinin **Etkinlikler** bölümünden etkinliği oluşturun.
2. Etkinlik kartındaki **Kayıt formu** düğmesine veya üstteki **Kayıt formları** sekmesine girin ve etkinliği seçin.
3. **Formun üst açıklaması** alanına katılımcının görmesini istediğiniz açıklamayı, ücret ve ödeme bilgilerini yazın. Açıklama formun üstünde görünür; satır sonları korunur.
4. Ad soyad, sınıf ve telefon alanları hazır gelir. Ad soyad her zaman zorunludur; sınıf ve telefonun zorunluluğunu değiştirebilirsiniz. Sınıf seçeneklerini de düzenleyebilirsiniz.
5. **Soru ekle** ile kısa/uzun cevap, e-posta, telefon, açılır liste, tek seçim, çoklu seçim veya **Fotoğraf yükleme** soruları ekleyin. Sorunun başlığını, seçeneklerini ve zorunluluğunu belirleyin. Temel alanlarla birlikte en fazla 25 soru olabilir.
6. Ücretli etkinliklerde **Ödeme bildirimi** seçeneğini açın. Asıl listeye başvuran kişi **Ödememi gönderdim** kutusunu işaretlemeden gönderemez; göndermeden önce işaretini kaldırabilir. Yedek başvurudan ödeme bildirimi istenmez. Yeni dekont yüklenmez. Özel fotoğraf soruları çalışmaya devam eder; fotoğrafların toplam dosya sınırı **4 MB** ve bağlantıları özeldir.
7. **Asıl kontenjan** alanına örneğin `40` yazın. Sınırsız olması için boş bırakın. İsterseniz **Yedek kayıt kabul et** seçeneğini açıp ayrı yedek sınırı belirleyin. Yedekler ve **Kalan kontenjanı katılımcılara göster** seçeneği varsayılan olarak kapalıdır.
8. **Kayıt formunu erişime aç** seçeneğini işaretleyip **Formu kaydet** düğmesine basın. Etkinlik yayımlanmamış olsa da kendi kayıt bağlantısı çalışır. Etkinlik kartındaki **Kayıt linkini kopyala** düğmesi paylaşabileceğiniz bağlantıyı verir.

Etkinliğin yayın durumu ile formun açık/kapalı durumu ayrıdır. **Yayından kaldır**, etkinliği genel etkinlik ve form listelerinden gizler; açık formun doğrudan bağlantısını kapatmaz. Kayıt almayı durdurmak için **Kayıt formunu erişime aç** işaretini kaldırıp kaydedin. Kontenjanı dolan, geçmiş günlerde kalan veya silinen etkinliğin formu yeni kayıt almaz. Kapalı bir taslak etkinliğin bilgileri doğrudan bağlantıyla açıklanmaz.

Bağlantı `form.html?event=ETKINLIK_KIMLIGI#registrationSection` biçimindedir. Katılımcı doğrudan o etkinliğin formuna ulaşır; formun önünde büyük bir afiş bulunmaz. Formlar sayfası açık olan tüm etkinlikleri listeler.

Form erişimini kapatmak mevcut kayıtları silmez. Türkiye tarihine göre günü geçmiş etkinlikler yeni kayıt almaz; aynı gün etkinlik başlangıç saatinin geçmesi formu kendiliğinden kapatmaz.

Asıl liste dolduğunda yedek alımı açıksa form başında başvurunun **yedek** olacağı belirtilir; başarı ekranı kesin katılım olmadığını tekrar açıklar. Her iki liste de dolduğunda form kapanır. Yedek kapalıysa eski dolu mesajı korunur. İptal edilenler yer kullanmaz. Aynı anda gelen başvurular asıl veya yedek sınırını aşamaz; aynı gönderimin yeniden denenmesi yeni yer kullanmaz. Sınırı mevcut asıl sayısının altına indirmek eski kayıtları düşürmez.

Asıl kayıt iptalinde veya kontenjan artışında yedekler başvuru sırasıyla aynı atomik kayıt işlemi içinde asıla alınır. Listede yükseltildiği gösterilir ve işlem geçmişine yazılır. Yedek alımını kapatmak mevcut yedekleri silmez. Sayaç kapalıyken herkese açık yanıtta asıl/boş yer sayıları bulunmaz; formun açık, yedek veya dolu olduğu belirtilir. Sayaç açıksa asıl doluluk ve kalan yer gösterilir; sınırsız kontenjanda sayısal ilerleme üretilmez.

Kaydedilmemiş form değişiklikleri etkinlikler arasında geçiş yaparken korunur. Sayfayı kapatmadan önce kaydedin. Soruları sonradan değiştirseniz de eski kayıtların soru başlıkları ve cevapları korunur.

## Fotoğraflı seçenekler ve fotoğraf cevapları

**Açılır liste**, **Tek seçim** ve **Çoklu seçim** sorularında her seçeneğin adını kendi satırında düzenleyebilirsiniz. Satırdaki **Fotoğraf ekle** düğmesiyle o seçeneğe görsel yükleyin. Görseli değiştirebilir veya kaldırabilir, seçenekleri yukarı/aşağı taşıyabilir ve yeni seçenek ekleyebilirsiniz. Fotoğraf ile adı aynı seçeneğe bağlı kalır. Formu kaydedince katılımcılar fotoğrafı ve seçeneğin adını birlikte görür. Görsel içeren açılır liste soruları tek seçim yapılabilen kartlar olarak gösterilir; görsel eklenmeyen eski açılır listeler normal görünümünü korur.

Katılımcının kendi fotoğrafını göndermesi için ayrı bir soru ekleyip cevap türünü **Fotoğraf yükleme** seçin. Başlığı örneğin “Çalışmanızın fotoğrafını gönderin” olarak değiştirin ve gerekiyorsa **Zorunlu alan**ı açın. Bu soru ödeme bildiriminden bağımsızdır. JPEG, PNG ve WebP fotoğrafları desteklenir; PDF fotoğraf cevabı değildir. Tüm fotoğraf cevapları birlikte en fazla 4 MB olmalıdır.

Gönderilen fotoğrafları kayıtların cevapları bölümündeki **Fotoğrafı görüntüle** düğmesinden açabilirsiniz. Yalnızca fotoğraf görüntüleme yetkisi olan yönetici oturumuyla erişilir; CSV'ye dosya adı yazılır, özel dosyanın bağlantısı eklenmez. Kaydı yalnızca baş yönetici silebilir; silmek o kayda bağlı fotoğraflara ve dekonta erişimi de kaldırır. Katılımcının başarı özetinde fotoğraflar veya özel cevaplar bulunmaz. Sayman kayıtları, ödeme durumlarını ve kaldırılmamış eski dekontları inceler; formu değiştiremez, fotoğraf/CSV/bilet işlemi veya kayıt silme yapamaz.

## Kayıtları inceleme

**Kayıt formları** sekmesinde seçilen etkinliğin toplam kayıt sayısını, üst sınırını ve sınıf dağılımını görebilirsiniz. İsim, telefon ve cevaplarda arama yapabilir; sınıfa göre filtreleyebilirsiniz. Başvurular **Asıl**, **Yedek** ve **İptal edilen** olarak ayrılır. Başvuru durumundan ayrı olarak ücretli asıl kayıtlarda **Onay bekleniyor / Onaylandı** ödeme durumu bulunur. Ödeme yönetme yetkisi olan yönetici kontrol edip durumu değiştirir. Önceki sürümün genel onay/red alanları yeni kabul veya ödeme durumu yerine kullanılmaz.

**Cevapları göster** tüm cevapları açar. **Dekontu görüntüle** dosyayı yalnızca yönetici oturumuyla getirir. Katılamayacak kişide **Kaydı iptal et** kullanın: geçmiş korunur, bileti kullanılamaz ve sıradaki yedeğe yer açılır. İptal ve silme yalnızca baş yöneticiye açıktır. Yanlış veya gereksiz bir başvuruyu **Kaydı sil** ile ayrıca kaldırabilirsiniz. Silinen kaydın dekontuna erişim de kaldırılır. Silme toplam kayıt sayısını azaltır; form erişime açıksa ve etkinliğin günü geçmediyse boşalan yer için tekrar kayıt alınabilir. **CSV indir** filtrelerden bağımsız olarak etkinliğin tüm mevcut kayıtlarını indirir.

**Etkinlikleri karşılaştır** bölümünde istediğiniz etkinlikleri seçerek kayıt sayılarını ve sınıflara göre dağılımı yan yana görebilirsiniz. Bunlar form kayıt sayılarıdır. Etkinliğe fiilen gelen kişiler ve QR bilet katılımları ayrı tutulur; form göndermek bilet oluşturmaz.

Aynı etkinlikte aynı telefonla gönderilmiş başvurular **Olası tekrar kayıtlar** filtresiyle bulunur. Bu bir uyarıdır; ortak telefon kullanan katılımcılar otomatik engellenmez. Cevapları karşılaştırıp gereksiz kaydı silebilirsiniz. **Bilet verilmemiş / Bilet verilmiş** filtreleri de kayıtların bilet durumunu gösterir.

**Etkinlik listesi → Arşiv** ile silinen etkinliklerin korunmuş cevaplarını, dekontlarını ve verilmiş biletlerini açabilirsiniz. Karşılaştırma tablosundaki **Kayıtları aç** düğmesi de ilgili etkinliğe gider. Arşivde form düzenleme ve yeni bilet verme kapalıdır; CSV indirme ve kayıt silme kullanılabilir.

## Form kaydından QR bileti verme

Katılımcının **asıl** kaydında **Bilet ver** düğmesine basın. Ödeme onayı bekleyen yeni kayda veya yedek/iptal kayda bilet verilmez. Eski verilmiş biletler geriye dönük ödeme zorunluluğuyla geçersiz sayılmaz; iptal edilen kaydın bileti ise engellenir. O kayda özel tek bir QR bileti hazırlanır. Etkinliğin özel bilet tasarımı varsa aynı tasarım kullanılır. Sonraki **Bileti görüntüle** işlemi aynı bileti açar; bağlantı kesildiğinde yeniden denemek ek bilet oluşturmaz. Form gönderimi otomatik QR bileti veya bilet indirmesi başlatmaz.

**Bağlantıyı kopyala** veya **WhatsApp’a yönlendir** ile kişiye özel `bilet.html#ERC-…` bağlantısını gönderin. Katılımcı hesaba giriş yapmadan tam bilet görselini açar, **Fotoğraf olarak indir** ile 2232 × 1176 piksel PNG veya **PDF indir** ile tek biletlik A4 yatay PDF indirebilir. Özel tasarımın oranı ve sağdaki QR konumu korunur. Dosya yalnızca indirme düğmesine basınca iner; bağlantıyı tekrar açmak veya dosyayı tekrar indirmek yeni QR oluşturmaz. İptal edilmiş bilet bağlantıları açılmaz. Bilet bağlantısını yalnızca sahibine iletin.

Panelde **Fotoğraf indir** ve **PDF indir · tek bilet** aynı dosyaları hazırlar. **PDF paylaş**, destekleyen telefonlarda PDF’yi sistem paylaşım ekranına verir; WhatsApp’ı ve alıcıyı siz seçersiniz. **WhatsApp’a yönlendir** ise kayıtlı telefon numarasının sohbetini mesaj ve bilet bağlantısıyla açar; PDF eki eklemez, mesajı siz gönderirsiniz. Mesajdaki **“Çekilişlere katılmak ve farklı ayrıcalıklardan yararlanmak için biletini hesabına ekle.”** çağrısı WhatsApp’ın kalın yazı biçimiyle hazırlanır. Telefon numarası yoksa WhatsApp’ın alıcı seçimi açılır. Dosya paylaşımı desteklenmeyen cihazlarda PDF’yi indirip elle ekleyebilirsiniz. Resmî WhatsApp API kurulumu gerekmez.

**Biletler** bölümündeki her biletin kişisel bağlantısını kopyalayabilir, fotoğrafını veya tek A4 PDF’sini indirebilirsiniz. Mevcut **Çıktı oluştur** düğmesi korunur: her A4 sayfada en fazla **10 bilet**, aynı kesim çizgileriyle basılır.

Bu işlem bilet oluşturur; katılımcının hesabına kendiliğinden eklemez. Katılımcı dijital biletteki **Biletimi hesabıma ekle** bağlantısına basar veya QR’ı okutur, giriş yapar veya hesap oluşturur, ardından **Katılımımı ekle** düğmesine basar. Hesaba ekleme, QR katılımcıları arasındaki çekilişler için kullanılır; biletin ekranda açılması veya indirilmesi çekilişe otomatik katılım sağlamaz. Hazır QR kodu varsa bu adım mobil sayfanın üstünde gösterilir. Kapıda görevli aynı bileti ayrıca okutur. Panelde **Hesaba eklendi** ve **Kapıda giriş yaptı** durumları ayrı gösterilir.

Form kaydını silmek o kayıttan verilmiş QR biletini de iptal eder. Daha önceki hesap katılımı, kapı giriş geçmişi ve çekiliş sonuçları bu işlemle silinmez. İptal sırasında bağlantı hatası olursa **Bilet iptali tamamlanmayı bekliyor** satırı kalır; **Bilet iptalini tamamla** ile aynı işlem yeniden denenir.

## Katılımcı kayıt özeti ve paylaşım

Başarılı form gönderiminden sonra etkinlik bilgileri ve kayıt referansı gösterilir. Katılımcı özeti kopyalayabilir veya metin dosyası olarak indirebilir. Özet bir QR bileti değildir; dekont ve form cevapları özete eklenmez.

Etkinlikteki **Paylaş** veya paneldeki **Etkinliği paylaş** düğmesi `https://ercupsa.com.tr/etkinlik/ETKINLIK_KIMLIGI` bağlantısını kullanır. WhatsApp gibi uygulamalar etkinliğin kendi afişini, adını ve tarihini görür. Açılan kartın düğmesi doğrudan kayıt formuna götürür. Paneldeki doğrudan **Kayıt linkini kopyala** bağlantısı da korunur.

Etkinlik düzenleyicisinde kaydedilmemiş taslaklar aynı tarayıcı sekmesinde etkinlikler arasında geçişte ve yenilemede korunur. **Kaydedilmiş etkinliğe dön** veya **Yeni taslağı sil** ile değişiklikleri kaldırabilirsiniz. Yönetici çıkışı taslakları temizler.

## Fotoğraf ve video yayın izni

Her formda ERCUPSA sitesi ve Instagram için ayrı, **isteğe bağlı** fotoğraf/video yayın izni bulunur. İşaretli gelmez; onay vermeden etkinliğe başvurulabilir. İzin tercihi, metin sürümü, kanallar ve kayıt zamanı tutulur. Eski başvuruların izni sonradan varsayılmaz. Bu tercih ödeme bildirimiyle birleştirilmez. Veri sorumlusu bilgisi beklenen genel KVKK aydınlatma metni ve zorunlu onay bu sürüme dahil değildir.

Yeni dekont alımı kapalıdır; eski dekontlar kendiliğinden silinmez. Ayrı envanter ve açık silme onayı süreci [GELISTIRME-VE-GECIS.md](GELISTIRME-VE-GECIS.md) belgesindedir.

## Mevcut Google Forms bağlantıları

Henüz site içi form kaydetmediğiniz etkinlikler mevcut Google Forms bağlantılarını kullanmaya devam eder. Bir etkinliğe site içi form kaydettiğinizde kayıt akışı bu forma geçer. Site içi formu kapatırsanız eski Google Forms bağlantısı otomatik açılmaz. Google Forms'taki eski cevaplar bu panele aktarılmaz.

## Yayımlama ve doğrulama

GitHub değişikliklerini Netlify üzerinden yayımlamak yeterlidir. Mevcut `ADMIN_PASSWORD` yönetici oturumu için kullanılır. Dekontlara, kayıt listelerine ve CSV dosyalarına erişim sunucuda yönetici oturumuyla korunur; herkese açık etkinlik API'sinde kayıt sayıları ve kişisel bilgiler bulunmaz.

Form kaydından bilet verme mevcut Supabase `create_ticket_batch` işlevini ve bilet tablolarını kullanır. Yeni SQL migration veya ortam değişkeni gerekmez.

Yerel doğrulama için `npm ci`, `npm run build`, `npm test` ve Netlify Dev açıkken `npm run test:browser` kullanılabilir. Kayıt testleri üretim verilerine yazmadan çalışır.
