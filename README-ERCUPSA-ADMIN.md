# ERCUPSA Yönetim Sistemi

Bu sürüm, Netlify üzerinde çalışan küçük bir içerik yönetim sistemi ekler.

## Kurulum
1. Projeyi Netlify'a deploy edin.
2. Netlify'da `Project configuration > Environment variables` bölümünden `ADMIN_PASSWORD` değişkenini ekleyin.
3. Cloudinary hesabı açın ve `Settings > Upload presets` altında bir **unsigned** upload preset oluşturun. Allowed formats: jpg, jpeg, png, webp; makul bir max file size belirleyin.
4. `admin.html` içindeki `CLOUDINARY_CLOUD_NAME` ve `CLOUDINARY_UPLOAD_PRESET` değerlerini kendi bilgilerinizle değiştirin.
5. Tekrar deploy edin.
6. `https://ercupsa.netlify.app/admin.html` adresinden yönetim panelini açın.

## Nasıl çalışır?
- Etkinlik bilgileri Netlify Blobs'ta saklanır.
- Fotoğraflar Cloudinary'ye toplu yüklenir.
- Etkinlik adı yalnızca bir kez girilir; fotoğraflar aynı etkinliğe bağlanır.
- Tarihi geçmiş etkinlikler otomatik olarak "Geçmiş Etkinlikler" bölümüne taşınır.
- Galeri sayfası etkinliklerdeki fotoğrafları otomatik gösterir.

## Güvenlik
`ADMIN_PASSWORD` sadece Netlify environment variable olarak tutulur. Cloudinary API secret kesinlikle frontend'e koyulmaz. Cloudinary unsigned preset'inizi sadece görsel yüklemeye izin verecek şekilde sınırlandırın.
