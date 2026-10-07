# Etkinlik çekilişleri

Yönetim panelindeki **Çekilişler** sekmesinde etkinliği seçin. Liste, etkinliğin bilet QR kodunu hesabına ekleyenlerden oluşur; form doldurmak veya bilet oluşturulmuş olması yeterli değildir. Girişte görevli tarafından QR okutulmasını şart koşmaz.

- Her kişi 1 hakla başlar. Daha önceki her farklı etkinlik +1 hak verir. Örneğin 3 önceki etkinlik = 4 hak.
- Aynı etkinliğin tekrarları ek hak oluşturmaz. Tarihi bilinen etkinliklerde seçilen etkinlikten önceki ve başlamış etkinlikler sayılır; gelecekteki etkinliğin erken eklenmiş bileti bonus vermez. Siteden kaldırılmış etkinliklerde, seçilen biletin hesaba eklenmesinden önceki kayıtlar esas alınır.
- İsim yanındaki işareti kaldırmak kişiyi sadece çekilişten çıkarır. Hesabı, katılım kaydı ve bileti korunur. Arama filtresi çekilişten çıkarmaz.
- Kazanan sayısını seçin (1–200, dahil edilen kişi sayısını aşamaz). Bir kişi aynı çekilişte birden fazla ödül kazanamaz. Her seçimde kalan kişilerin haklarıyla ağırlıklı rastgele seçim yapılır.
- **Çekilişi başlat** yaklaşık 5 saniye isimleri değiştirir, ardından kazananları gösterir. Hareketi azaltma tercihi olan cihazlarda hızlı isim değişimi ve animasyon kaldırılır; sonuç süresi korunur.
- Sonuç otomatik olarak etkinliğin çekiliş geçmişine kaydedilir. Yeni çekilişlerde önceki kazananlar tekrar katılabilir. Yanlış çekilişi **Çekilişi sil** ile kaldırıp yeniden çekebilirsiniz.
- Bağlantı sorunu olursa **Aynı çekiliş sonucunu yeniden sorgula** mevcut isteği tekrarlar; yeniden kazanan seçmez. Sonucu kontrol etmeden yeni çekiliş açmayın.

Katılımcılar Supabase'deki `claim_ticket` işleminin oluşturduğu `attendance` kayıtlarından, adlar `profiles` tablosundan okunur. Sayfalama kullanılır; 1000 kayıt sınırı geçmiş katılımları sessizce kesmez. Çekiliş hakları ve kazananlar sunucuda hesaplanır; tarayıcının gönderdiği haklara güvenilmez. Rastgele seçim Node'un kriptografik `randomInt` işleviyle yapılır; ekrandaki hareket yalnızca görseldir.

Geçmiş, `ercupsa-raffles` adlı özel Netlify Blobs deposunda tutulur. Yönetici oturumu gerekir; yabancı kaynaklı değişiklikler reddedilir. Silinen çekilişin kişi bilgileri kaldırılır; silinen istek kimliği yeniden kullanılınca çekiliş geri oluşturulmaz. Eşzamanlı işlemlerde koşullu yazma kullanılır. Yeni veritabanı tablosu, SQL çalıştırılması veya ek ortam değişkeni gerekmez; mevcut Supabase ve yönetici ayarları kullanılır.
