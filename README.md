# ERCUPSA web

Statik site, Netlify Functions/Blobs, Supabase hesap ve QR bilet sistemi, Cloudinary görselleri.

```bash
npm ci
npm run build
npm test
```

Netlify Dev açıkken `npm run test:browser`; yerel yönetici parolasıyla `npm run test:smoke` çalıştırılabilir. Smoke testi yalnızca localhost kabul eder. Testlerde üretim bağlantıları yerine izole depolar ve sahte veritabanı kullanın.

- [Yönetim ve yetkiler](README-ERCUPSA-ADMIN.md)
- [Kayıt formları ve dijital biletler](KAYIT-SISTEMI.md)
- [QR girişleri](ETKINLIK-GIRIS.md)
- [Çekilişler](CEKILISLER.md)
- [Yedekler, ödeme, raporlar, yıllıklar ve güvenli geçiş](GELISTIRME-VE-GECIS.md)
- [Eski dekontlar için salt okunur envanter](DEKONT-ENVANTERI.md)

Galeri mevcut albüm/veri yapısını kullanmaya devam eder; yıllıklar ayrı bir özelliktir. Genel KVKK aydınlatma metni, veri sorumlusu bilgisi kesinleşene kadar bekletilir. GitHub gönderimi, canlı dağıtım ve üretim veri değişikliği ayrı talimat gerektirir.
