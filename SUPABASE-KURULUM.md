# ERCUPSA topluluk ve bilet kurulumu

Siteyi gezmek ve testi çözmek için hesap gerekmez. Bilet hesabı yalnızca **Biletlerim** sayfasında, isim, soyisim, e-posta ve şifreyle açılır; giriş e-posta/şifreyle yapılır. Telefon numarası toplanmaz.

## 1. Supabase projesi

1. Supabase üzerinde bir proje oluşturun; veritabanı parolasını güvenli saklayın.
2. SQL Editor'de `supabase/schema.sql` dosyasının tamamını çalıştırın. Dosya yeniden çalıştırılabilir. Tablolarda RLS açıktır; tarayıcıdan doğrudan tablo erişimi yoktur. Bilet kullanımı veritabanı işlemi içinde kilitlenir.
3. Project Settings / API bölümünden proje URL'sini ve **anon public** anahtarını alın. Sunucu için eski biçimli **service_role** anahtarını alın. Service role anahtarı tarayıcıya, depoya veya sohbete konulmamalıdır.
4. **Authentication → Sign In / Providers → Email** bölümünde e-posta sağlayıcısını ve yeni kayıtları etkinleştirin. **Confirm email** seçeneğini **kapatıp kaydedin**. Kayıtta onay e-postası gönderilmez; Supabase doğrudan oturum açar. Bu ayar GitHub koduyla veya `schema.sql` ile değişmez. Proje erişimi olan kişi Supabase panelinden uygulamalıdır. En az 8 karakterlik şifre kuralını Supabase ayarlarında da etkinleştirin. Kimlik doğrulama ve istek sınırlarını kapatmayın.
5. **Authentication → Email → Reset Password** şablonunda sıfırlama bağlantısı için `{{ .ConfirmationURL }}` kullanın; yalnızca `{{ .Token }}` içeren eski şablon bu akışta yeterli değildir. Şifremi unuttum e-postaları için özel SMTP sağlayıcısı ayarlayın. Supabase'in varsayılan e-posta servisi genel kullanıma uygun gönderim kapasitesi sağlamaz. Kayıt ve normal giriş e-posta göndermez; şifre sıfırlama SMTP düzgün çalışmadan hazır sayılmaz.
6. **Authentication → URL Configuration** bölümünde Site URL'yi gerçek alan adınıza ayarlayın. **Redirect URLs** listesine `https://ercupsa.com.tr/biletler.html?recovery=1` adresini ekleyin (siteyi başka alan adında kullanıyorsanız o alan adını kullanın). Yerel test için `http://localhost:8888/biletler.html?recovery=1` adresini ayrıca ekleyebilirsiniz. Sıfırlama e-postasını isteği yaptığınız tarayıcıda açın; PKCE doğrulaması için o tarayıcıda tutulan doğrulayıcı gerekir.

## 2. Netlify ortam değişkenleri

Netlify Project configuration / Environment variables'da aşağıdakileri ekleyin. Sunucu anahtarını yalnızca Functions kapsamına verin:

- `SUPABASE_URL`: `https://PROJE.supabase.co`
- `SUPABASE_ANON_KEY`: anon public anahtarı (bu anahtar herkese açık olabilir; tablo erişimi RLS ile engellenir).
- `SUPABASE_SERVICE_ROLE_KEY`: yalnızca sunucunun kullandığı gizli service_role anahtarı.
- `ADMIN_PASSWORD`: yönetici parolası; güçlü ve benzersiz bir değer kullanın.

Yerel çalışma için `.env.example` dosyasından `.env` oluşturun ve değerleri güvenli şekilde girin. `.env` Git tarafından yok sayılır. Bulut ortamında da aynı değişkenler güvenli ortam ayarlarına eklenmelidir. Ağ ayarlarına **kendi projenizin tam Supabase alan adını** ekleyin; henüz proje olmadığı için örnek alan adına izin verilmedi.

## 3. Derleme ve çalışma

Node 24 ile:

```sh
npm ci
npm run build
npm test
```

Netlify `netlify.toml` içindeki derleme komutunu kullanır ve yalnızca `dist` dizinini yayımlar. SQL, test dosyaları, paketler ve ortam dosyaları yayımlanan dizine alınmaz. Netlify Functions ayrı paketlenir. Geliştirme için Netlify CLI kuruluysa `npm run dev` kullanılır. CLI'nin Edge Functions indirmesi ağda engellenirse bu depo Edge Functions kullanmadığından yerel komuta `--internal-disable-edge-functions` eklenebilir; bu seçenek CLI sürümüne bağlıdır.

Yerel ve üretim Blobs ayrı ortamlardır; mevcut etkinlik verisi Netlify Blobs'ta kalır. Yeni üyeler, öneriler, deneyimler ve biletler Supabase'te tutulur. Hiçbir mevcut etkinlik taşınmaz veya silinmez.

## 4. Yönetim ve kullanım

- Admin girişi HttpOnly, SameSite=Strict, 8 saatlik imzalı çerez kullanır. Eski tarayıcı parola kaydı kaldırılır. Giriş denemeleri 15 dakikada 10 ile sınırlıdır.
- Üyeleri ad-soyad ve sınıfla ekleyin; aktif/pasif durumu yoktur. Üyenin yayımlama iznini alın.
- Etkinlik önerileri yönetimde kalır. Anonim deneyimleri kişisel bilgileri ayıkladıktan sonra onaylayın. İsim/e-posta istenmez; kötüye kullanım sınırı için ham IP yerine tek yönlü bir türev tutulur.
- İlgili etkinlikte **Bilet oluştur** seçin, 1–200 bilet üretin. 50 varsayılandır. Her yeni grup önceki kodları korur. QR biletleri **Yazdır / PDF olarak kaydet** ile dağıtın. PDF için tarayıcının yazdırma penceresindeki PDF hedefini seçin.
- Kodları gerçekten katılanlara verin. Kodlar kişiye bağlanana kadar sahibinin elindeki bilet olarak kabul edilir; paylaşan kişinin kimliğini kod tek başına kanıtlamaz.
- Bilet grupları sonradan tekrar yazdırılabilsin diye kodlar yalnızca sunucu/yönetici erişimli tabloda tutulur. Hak iddiası SHA-256 özeti üzerinden yapılır. Kullanılmamış bilet iptal edilebilir; kullanılmış bilet iptaliyle katılım sessizce değiştirilmez.
- Öğrenci isim, soyisim, e-posta ve şifreyle kayıt olur; e-posta onayı istenmez. Sonraki girişlerde e-posta/şifre kullanır. Şifre unutulursa e-posta bağlantısıyla yeni şifre belirlenir. Oturum tarayıcıda korunur; çıkış yapınca kaldırılır. Adını düzenleyebilir ve kod ekleyebilir. Bir etkinlik yalnızca bir kez sayılır. 3 etkinlik bronz, 4 gümüş, 5+ altın. İsim ancak öğrencinin ayrı onayıyla rozet panosunda görünür; e-posta yayımlanmaz.

## 5. Canlı doğrulama

Gerçek proje bağlandıktan sonra önce test etkinliği ve iki test hesabıyla: onaysız hesap oluşturma, e-posta/şifreyle giriş, çıkış, sayfa yenileme sonrası oturum, şifre sıfırlama e-postasının teslimatı ve bağlantıyla yeni şifre belirleme, üye ekleme/düzenleme/silme, öneri inceleme, deneyim onayı, 50 kod üretimi ve QR/PDF, bir kodun ikinci kullanımının reddi, aynı etkinliğin ikinci biletiyle tekrar puan alınamaması, 3/4/5 rozet eşikleri ve isim görünürlüğü denenmelidir. Yerel otomatik testler veritabanı kurallarını ve arayüzü kontrol eder; canlı e-posta teslimatının yerini tutmaz.

Silme ve yedekleme talepleri için kulübün erişebileceği bir iletişim yolu belirleyin; profil ve katılım tabloları kişisel veri içerir. Supabase yedekleme ve SMTP kapasitesini beklenen katılımcı sayısına göre seçin.
