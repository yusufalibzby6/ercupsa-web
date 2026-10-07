# Etkinlik girişi ve görevli hesapları

Yönetim panelindeki **Giriş ve görevliler** sekmesinden etkinliği seçin. Formla kayıt olanların, biletini hesabına ekleyenlerin ve kapıdan girenlerin sayıları ayrı gösterilir. Bu sayılar farklı aşamaları ölçer; form kaydı tek başına bilet veya giriş oluşturmaz. Katılımcı listesinde isimle arayabilir, giriş zamanını görebilirsiniz. Panel görünürken liste düzenli aralıklarla yenilenir.

**Görevli hesabı oluştur** bölümünde ad, kullanıcı adı, şifre ve izin verilecek etkinlikleri seçin. Görevli, sitenin `/giris.html` adresinden giriş yapar. Yönetici de mevcut oturumuyla bu sayfayı açabilir. Görevlinin yalnızca seçilen etkinliklerde kapı girişi yapma yetkisi vardır; kayıt formlarına, dekontlara, çekilişlere veya diğer yönetim işlemlerine erişemez. Hesabı panelden kaldırmak açık görevli oturumlarını da geçersiz kılar. Yetki veya şifre değiştirmek için hesabı kaldırıp yeniden oluşturabilirsiniz.

Kapıda etkinliği seçip **Kamerayı aç** ile mevcut bilet QR kodunu okutun. Bilet bağlantısını ya da `ERC-` ile başlayan kodu elle girmek de mümkündür. Kamera için HTTPS ve tarayıcı kamera izni gerekir. Kamera kullanılamıyorsa kod girişi ve isimle giriş seçenekleri çalışmaya devam eder.

- **Giriş başarılı:** Bilet ilk kez kapıda kullanılmıştır.
- **Daha önce giriş yapılmış:** Aynı bilet tekrar okutulmuştur; ikinci bir giriş kaydı oluşturulmaz.
- **Başka etkinliğin bileti / geçersiz veya iptal edilmiş bilet:** Giriş kaydedilmez.

QR'sini açamayan ve biletini hesabına eklemiş kişiler isimle bulunup onay verilerek elle giriş yapabilir. Hesaba eklenmemiş geçerli bir bilet QR ile girişte kabul edilir; panelde henüz isimle eşleşmeyen bilet olarak görünür. Bilet daha sonra bir hesaba eklendiğinde giriş o hesaba bağlanır. QR okutmak bileti katılımcının hesabına otomatik eklemez.

Çekilişte **Yalnızca giriş yapanlar katılsın** ve **Ek haklar gerçek girişlerden hesaplansın** seçenekleri ayrı ayrı kullanılabilir. Hesaba eklenmemiş biletler, kapıda okutulmuş olsa bile çekilişe katılmaz. Önceki dönemler için geriye dönük gerçek giriş kaydı üretilmez; bu seçenek sadece kaydedilmiş girişleri sayar. **Önceki katılımlar ek hak versin** seçeneği kapalıysa geçmiş girişlerden bağımsız herkesin bir hakkı vardır. Kazananların ödül teslim durumu çekiliş geçmişinden işaretlenebilir.

Etkinlik değerlendirmesi **Biletlerim** sayfasındaki etkinliklerden yapılır. Etkinlik tarihi geçtikten sonra katılımcı puan ve yorum bırakabilir, kendi değerlendirmesini düzenleyebilir. Yorumlar sitede herkese yayımlanmaz; yönetim panelindeki **Değerlendirmeler** sekmesinde ortalama, puan dağılımı ve yorumlar görünür.

Mevcut Supabase bilet ve hesap tabloları kullanılır. Girişler ve görevli hesapları özel `ercupsa-operations` Netlify Blobs deposunda, değerlendirmeler özel `ercupsa-feedback` deposunda tutulur. Yeni SQL veya ortam değişkeni gerekmez. Görevli şifreleri rastgele tuzla scrypt kullanılarak özetlenir; oturum çerezi HttpOnly ve HTTPS'te Secure'dür, sekiz saat geçerlidir. Aynı bilete eşzamanlı girişlerde koşullu yazma ikinci kaydı önler. Bağlantı hatası sonrası aynı bileti yeniden kontrol etmek yeni giriş oluşturmaz.
