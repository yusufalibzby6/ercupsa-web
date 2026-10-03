# Etkinliğe özel bilet tasarımları

Yönetim panelinde **Biletler** sekmesini açın ve etkinliği seçin. “Boş PNG şablonunu indir” bağlantısıyla başlangıç görselini, “Ölçü rehberini indir” bağlantısıyla işaretli SVG rehberini alın. Şablonun sol kısmını Canva, Photoshop veya tercih ettiğiniz uygulamada düzenleyin. SVG rehberi düzenlenebilir; siteye yüklemek için PNG veya JPEG olarak dışa aktarın.

## Sabit ölçüler

| Alan | Piksel | Baskıda |
| --- | --- | --- |
| Tam tuval | 1116 × 588 | 93 × 49 mm |
| Tasarlayacağınız sol alan | x: 0–743, y: 0–587 | 62 × 49 mm |
| Otomatik beyaz sağ alan | x: 744–1115, y: 0–587 | 31 × 49 mm |
| QR görseli | x: 792, y: 60; 288 × 288 | x: 66 mm, y: 5 mm; 24 × 24 mm |

Bir milimetre 12 piksele karşılık gelir. Tuval boyutlarını değiştirmeyin; tasarımı tam **1116 × 588 piksel** olarak dışa aktarın. Biçim PNG veya JPEG, dosya boyutu en fazla **3 MB** olmalıdır. Site SVG veya PDF kabul etmez. PNG için şeffaf arka plan gerekiyorsa baskının beyaz zeminini dikkate alın.

Sağdaki 372 pikseli boş bırakın. Site bu alanı her zaman beyaz örter, QR kodunu, biletin benzersiz kodunu ve durumunu ekler. Görselde sağ tarafa koyduğunuz metin veya logo baskıda görünmez. QR görseli dört modüllük beyaz boşluk içerir; QR konumu ve boşluğu değiştirilmez. Şablonda gerçek QR yoktur.

Sol tarafta etkinlik adı, tarih, renk, logo ve görselleri tamamen siz düzenleyebilirsiniz. Özel tasarım kullanıldığında site sol alana ek metin yazmaz; “Sürpriz hediyeler sizi bekliyor.” ifadesini özel bilette de istiyorsanız kendi görselinize ekleyin. Standart tasarım bu ifadeyi otomatik gösterir.

## Yükleme ve baskı

1. Etkinliği seçin, PNG/JPEG dosyanızı seçin ve önizlemeyi inceleyin.
2. **Tasarımı yükle** düğmesine basın. Seçilen fakat kaydedilmemiş tasarımla bilet oluşturulamaz veya basılamaz; **Seçimi iptal et** mevcut tasarıma döndürür.
3. Bilet kodlarını oluşturun veya aynı etkinliğe ait önceki bir bilet grubunu açın.
4. **Çıktı oluştur** ile A4 baskıyı açın. Her sayfa iki sütun, beş satır ve en fazla on bilet içerir. Ölçek **%100 / gerçek boyut**, kağıt **A4** olmalıdır; tarayıcının üstbilgi/altbilgi seçeneğini kapatın.

Her etkinliğin tasarımı ayrı saklanır. Yeni tasarım o etkinliğin eski bilet gruplarına da uygulanır; mevcut bilet kodları ve katılım durumu değişmez. **Standart tasarıma dön** sadece seçili etkinliğin özel görselini kaldırır. Tasarım okunamaz veya bağlantı başarısız olursa site eski bir görselle baskı açmaz; **Bağlantıyı yeniden dene** ile kaydedilmiş tasarımı tekrar kontrol edin.

Dosyalar yönetici doğrulamasıyla Netlify Blobs üzerinde saklanır; yükleme Supabase şemasını değiştirmez. Tasarıma kişisel bilgiler, erişim anahtarları veya bilet QR kodları koymayın.
