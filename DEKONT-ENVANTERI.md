# Eski dekontların temizliğine hazırlık

Yeni başvurularda dekont yükleme kapatıldı. Etkinliğin ödeme beyanı ayarı açık olduğunda asıl kayıt için “Ödememi gönderdim” işareti istenir; ödeme kontrolü panelde yapılır. Form sorularındaki bağımsız fotoğraf yükleme alanları bu değişikliğin kapsamında değildir.

Mevcut dekontlar bu geliştirme sırasında üretim ortamından silinmedi. Kayıtların ve biletlerin korunması için temizlik ayrı bir işletim adımıdır. Eski özel dekont bağlantıları, yetki kontrolüyle, dosyalar gerçekten temizlenene kadar kullanılabilir.

## Salt okunur envanter

Yetkilendirilmiş Netlify Blobs ortamında:

```bash
node scripts/receipt-cleanup.mjs --dry-run
```

İsteğe bağlı yerel rapor:

```bash
node scripts/receipt-cleanup.mjs --dry-run --output /tmp/ercupsa-dekont-envanteri.json
```

Bu araçta silme veya veri güncelleme yolu bulunmaz. Yalnızca kayıt JSON belgeleri ve dekont deposunun anahtar listesi okunur; dekontların içeriği indirilmez. Fotoğraf ve bilet depoları açılmaz. Rapor, kişi adı, telefon, dosya adı veya dosya anahtarı içermez. Var olan bir çıktı dosyası üzerine yazılmaz. Eksik veya bozuk kayıt yapısında eksik bir rapor üretmek yerine işlem durur.

Netlify erişim bilgilerini komut satırına veya rapora yazmayın. Aracı yanlışlıkla başka ortamda çalıştırmamak için önce mevcut ortam bağlantısını doğrulayın. Bu komut yeni bir üretim bağlantısı veya üretimde veri değiştirme izni sağlamaz.

## Üretimde silmeden önce

1. Hedef site ve ortamı, kayıt/fotoğraf depolarından ayrı olan `ercupsa-registration-receipts` deposunu doğrulayın.
2. Aynı ortamda güncel envanteri çıkarın. Mevcut saklama ihtiyacını ve kullanıcı tarafından verilen silme talimatını doğrulayın; yeni bir dekont yedeği oluşturmayın.
3. Ayrı bir temizleme işlemi için açık üretim onayı alın. Bu envanter aracına `--apply` eklenerek silme yapılamaz.
4. Kayıtlar, soru fotoğrafları, biletler ve QR giriş geçmişi silinmeden yalnızca dekont dosyaları ve ilgili dekont referansları temizlenmelidir. Eski `entries/` kayıtları ile yeni `state/` belgelerindeki referanslar birlikte ele alınmalıdır; eski veri yolundan dekontların yeniden görünmesi engellenmelidir.
5. Sonrasında dosyaların artık açılamadığını; kayıt listesi, bilet paylaşımı, giriş ve fotoğraf sorularının çalışmaya devam ettiğini kontrol edin.

Genel KVKK aydınlatma metni, veri sorumlusu bilgisi kesinleşene kadar ayrıca bekletilmektedir. Instagram gömülü içerik tercihi ve isteğe bağlı etkinlik fotoğraf/video yayın izni bu metnin yerine geçmez.
