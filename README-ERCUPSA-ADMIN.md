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

Panelde **Etkinlikler**, **Kayıt formları**, **Biletler**, **Çekilişler**, **Giriş ve görevliler** ve **Instagram** bölümleri bulunur. Geniş ekranda soldaki menüden, telefonda üstteki menüden geçiş yapılır. Öneriler, deneyimler ve değerlendirmeler sekmeleri kaldırılmıştır.

Hesaplar ve QR bilet kurulumu için [SUPABASE-KURULUM.md](SUPABASE-KURULUM.md), kapı girişleri için [ETKINLIK-GIRIS.md](ETKINLIK-GIRIS.md), çekiliş kuralları için [CEKILISLER.md](CEKILISLER.md) belgesini izleyin. Yönetici parolası tarayıcı depolamasında tutulmaz. `npm ci`, `npm run build` ve `npm test` kullanılabilir.

## Ana sayfanın Instagram paylaşımları

**Instagram** sekmesindeki dört alana paylaşım veya Reels bağlantılarını yapıştırın ve **4 paylaşımı kaydet** düğmesine basın. Alanların sırası ana sayfadaki kartların sırasıdır; eski bağlantının yerine yenisini kaydederek o kartı değiştirebilirsiniz. Instagram hesabına giriş veya API anahtarı gerekmez.

Yalnızca `https://www.instagram.com/p/.../` ve `https://www.instagram.com/reel/.../` biçimindeki paylaşım bağlantıları kabul edilir. İzleme parametreleri temizlenir. Ana sayfa kaydedilmiş dört bağlantıyı kullanır; Instagram gömme içeriği yüklenemezse paylaşımı Instagram'da açabileceğiniz bağlantı görünür. Bu ayar Netlify Blobs'ta saklanır; yeni SQL kurulumu veya ortam değişkeni gerekmez.

## Etkinlik kayıt formları

Site içi form hazırlama, sınıf ve telefon alanları, zorunlu sorular, özel dekontlar ve etkinlik karşılaştırması için [KAYIT-SISTEMI.md](KAYIT-SISTEMI.md) belgesini izleyin. Bu özellik mevcut Netlify kurulumuyla çalışır.
