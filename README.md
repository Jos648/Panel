# DevDeck V1

Telefondan/bilgisayardan dosya, klasör ve arşiv (ZIP · RAR · 7Z) alıp
otomatik extract ederek seçili GitHub reposuna **tek commit** ile gönderen,
tamamen tarayıcıda çalışan developer dashboard.

## Kurulum

1. **OAuth App oluştur**
   GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
   - Homepage URL: `http://localhost:3000`
   - Callback URL: `http://localhost:3000/callback` (device flow'da kullanılmaz, zorunlu alan)
   - **Client Secret gerekmez.**
2. Client ID'yi `config.js` → `GITHUB_CLIENT_ID` alanına yaz.
3. ES Modules `file://` üzerinden çalışmaz; yerel sunucu başlat:
   ```bash
   npx serve .          # veya
   python3 -m http.server 3000
   ```
4. Tarayıcıda aç, "GitHub ile Bağlan" → kodu gir → onayla.

> Device flow istekleri tarayıcıda CORS'a takılırsa `config.js` → `OAUTH_PROXY`
> alanına github.com/login/oauth/*'e ileten küçük bir proxy adresi ver.

## V1 kapsamı (sabit)

Bağlantı (OAuth Device Flow) → Repo seçimi (kalıcı) → Dosya/klasör/arşiv
yükleme + otomatik extract → Dosya ağacı önizleme → Git blob SHA-1 ile
değişiklik analizi (yeni / güncellenecek / değişmeyen) → Tek commit ile
gönderim + canlı ilerleme.

## Güvenlik & limitler

- Token yalnızca `sessionStorage`'da; sekme kapanınca silinir, log/hata mesajına yazılmaz.
- API hataları genel mesajlara eşlenir; sunucu detayı UI'a yansımaz.
- Tüm yollar `sanitizePath`'ten geçer: `..`, mutlak yol, kontrol karakteri,
  rezerve adlar reddedilir (Zip-Slip koruması).
- Limitler `config.js`'te: dosya başı 100MB (GitHub blob sınırı), toplam 250MB, 2000 dosya.
- Bilinen V1 kısıtları: çalıştırılabilir bit (+x) korunmaz; 100k öğeden büyük
  repolarda karşılaştırma kısmidir (GitHub ağaç API sınırı).

## V1.1 — Uygulanan kritik fixler

Bu sürümde 4 kritik bug fixlendi (bkz. ilgili dosyalardaki `✅ FIX` yorumları):

1. **Boş repo → crash** (`js/services/github-api.js`) — ilk commit atılırken
   `baseTree` artık açıkça `null` bırakılıyor, `base_tree` alanı yalnızca
   varsa isteğe ekleniyor.
2. **Race condition: state + bus** (`js/core/store.js`) — `store.batch()`
   eklendi; birden fazla `set()` artık tek bir atomik emit'e toplanıyor.
3. **Sıralı SHA-1 → UI donması** (`js/services/diff.js`) — hash hesaplama
   artık 4 paralel işçi ile yapılıyor, yalnızca remote'da eşleşen dosyalar
   hash'leniyor.
4. **Ağ hatası → anında başarısızlık** (`js/services/github-api.js`) — tüm
   istekler artık `apiWithRetry()` üzerinden geçiyor; 429/5xx hataları
   exponential backoff (jitter'lı) ile otomatik yeniden deneniyor.

Ek olarak `js/core/event-bus.js` içinde hata loglama bağlamla zenginleştirildi.

Mimari (services/ui ayrımı, bus, tek config noktası) sabit kalıyor — yeni
dosya/modül eklenmedi, breaking change yok.
