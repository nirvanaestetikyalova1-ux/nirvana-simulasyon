# Nirvana Önce/Sonra Simülasyon — Bulut Sunucu Kurulumu

Bu paket, programı tek bir bilgisayara bağlı olmaktan çıkarıp **her şubeden aynı
web adresiyle** kullanılabilir hale getirir. API anahtarları artık bu sunucuda
saklanır; hiçbir bilgisayarda anahtar girmeniz gerekmez.

İçerik:
- `server.js` — arka uç sunucu (bağımlılığı yok, sadece Node.js)
- `package.json`
- `Nirvana-Once-Sonra-Simulasyon.html` — programın arayüzü (kasıtlı olarak
  server.js ile aynı klasörde/kökte; kurulumu basitleştiriyor)

---

## 1) GitHub'a yükleyin (kod deposu)

1. github.com adresine gidip ücretsiz bir hesap açın (yoksa).
2. Sağ üstten **"+" → "New repository"** ile yeni bir depo oluşturun. Adı örneğin
   `nirvana-simulasyon` olsun, **Private** (özel) seçin, "Create repository"ye basın.
3. Açılan sayfada **"uploading an existing file"** bağlantısına tıklayın.
4. Bu paketteki `server.js`, `package.json`, `Nirvana-Once-Sonra-Simulasyon.html`
   ve `DEPLOY.md` dosyalarının hepsini birden sürükleyip bırakın, sonra
   **"Commit changes"**e basın.

## 2) Render.com'da barındırma hesabı açın

1. render.com adresine gidip **"Get Started"** ile hesap açın — GitHub hesabınızla
   giriş yapmanız işleri kolaylaştırır ("Sign up with GitHub").
2. Render'a GitHub deponuza erişim izni verin (sorulduğunda).

## 3) Yeni bir Web Service oluşturun

1. Render panelinde **"New +" → "Web Service"**e tıklayın.
2. Az önce yüklediğiniz `nirvana-simulasyon` deposunu seçin.
3. Ayarlar:
   - **Name:** `nirvana-simulasyon` (adres bu isme göre oluşur)
   - **Region:** Frankfurt (Türkiye'ye en yakın seçenek)
   - **Branch:** main
   - **Build Command:** boş bırakın (veya `npm install`)
   - **Start Command:** `node server.js`
   - **Instance Type:** **Starter** seçin (ücretli, ~7$/ay) — **Free** planı SEÇMEYİN,
     çünkü kullanılmadığında uyku moduna girer ve müşteri karşısında ilk açılış
     30-60 saniye gecikir. 5 şube/15 kişi için Starter yeterlidir.

## 4) API anahtarlarını girin (Environment Variables)

Aynı sayfada **"Environment Variable"** bölümüne şunları ekleyin:

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio'dan aldığınız anahtar |
| `FAL_KEY` | fal.ai anahtarınız (`key_id:key_secret` formatında) |
| `OPENAI_API_KEY` | (isteğe bağlı) OpenAI anahtarınız |
| `APP_ACCESS_CODE` | **Önerilir** — şubelerin gireceği basit bir kod, örn. `nirvana2026`. Bu olmadan adresi bilen HERKES (internetten) sizin kredinizi harcayarak görsel üretebilir. |
| `YOUCAM_CLIENT_ID`, `YOUCAM_CLIENT_SECRET` | (ileride) YouCam anahtarı alındığında eklenecek |

**"Create Web Service"**e basın. İlk kurulum birkaç dakika sürer.

## 5) Adresi alın ve şubelerle paylaşın

Kurulum bitince Render size şöyle bir adres verir:
`https://nirvana-simulasyon.onrender.com`

Bu adresi (ve varsa `APP_ACCESS_CODE` olarak belirlediğiniz kodu) 5 şubedeki
bilgisayarlara/tabletlere gönderin. Herkes bu adresi tarayıcıda açıp
sekmelere/favorilere ekleyebilir — artık `Sunucu_Baslat.bat` çalıştırmaya veya
dosya indirip taşımaya gerek yok.

## 6) Test edin

1. Adresi açın, sayfanın üstünde build numarasını görün.
2. Erişim kodu sorduysa girin (bir kere, tarayıcı hatırlar).
3. Ayarlar panelinde **"Sunucu tarafında aktif servisler"** listesinde ✅ görmelisiniz.
4. **"🔌 Bağlantı Testi Yap"**a basıp Gemini/fal.ai/OpenAI satırlarının ✅ olduğunu
   doğrulayın.
5. Bir fotoğrafla gerçek bir simülasyon deneyin.

---

## Sonradan anahtar değiştirme / güncelleme

Render panelinde ilgili servise girip **Environment** sekmesinden anahtarları
istediğiniz zaman değiştirebilirsiniz — değişiklik birkaç saniyede devreye girer,
hiçbir bilgisayarda bir şey yapmanız gerekmez.

## Maliyet özeti

- Render Starter: ~7 USD/ay (sunucu barındırma)
- Gemini / fal.ai / OpenAI / YouCam: kullanım başına ayrı ücretlendirilir (bu
  barındırma ücretine dahil değildir)
