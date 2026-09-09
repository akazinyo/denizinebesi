# Denizinebesi

Three.js / WebGPU ile açık denizde motorbot ve gezi gemisi simülasyonu.

## Çalıştırma

Bu klasörde terminal açıp `./BASLAT.sh` çalıştır. Sonra **http://localhost:8080** adresini aç. Alternatif: `bun run dev`. İlk kurulum dışında internet gerekmez; tüm görseller ve sesler kodla oluşturulur. `index.html` dosyasını doğrudan çift tıklamak yerine yerel sunucuyu kullan.

WebGPU destekleyen güncel Chrome/Edge ve donanım hızlandırması önerilir. WebGPU başlatılamazsa Three.js WebGL2 uyumluluk motorunu dener; kullanılan motor ayar panelinde görünür. Sonradan GPU bağlantısı kaybolursa hata ekranındaki düğmeyle uyumluluk moduna geçilebilir. Doğrudan adres: http://localhost:8080/?compat=1.

## Kontroller

- **W / ↑:** ileri gaz, **S / ↓:** geri gaz. Bırakınca tekne ataletle yavaşlar.
- **A / D veya ← / →:** dümen. Dururken tekne kendi ekseninde dönmez.
- **Boşluk:** hızlı yavaşlama.
- **C:** takip, kaptan, yörünge kamerası.
- **Fare sürükleme / tekerlek:** dış kameralarda açı / mesafe.
- **R:** başlangıca dön; **H:** ayar panelini aç/kapat.
- Dokunmatik ekranlarda alttaki yön düğmeleri kullanılabilir.

Panelden günün saati, otomatik zaman akışı, dalga şiddeti, tekne, kalite ve ses değişir. Ses kullanıcı tıklamasıyla açılır. Radar 500 metre yarıçapındaki şamandıraları gösterir.

## Görüntü ve simülasyon

GPU üzerinde dört sinüs dalgası, teknenin altında aynı dalgaları örnekleyen yüzme/yatma hareketi, çok ölçekli su normalleri, düzlemsel sahne yansımaları, Fresnel su rengi, güneş/ay parlaması, gövde gölgeleri, atmosferik gökyüzü ve bulutlar, yıldızlar, seyir ışıkları, motor izi ve bloom kullanılır. İki teknenin hız/dönüş davranışları farklıdır.

Bu görsel bir simülasyondur; mühendislik düzeyinde akışkanlar veya gemi hidrodinamiği çözümü değildir. Su yansıması dalga normalleriyle bozulan düzlemsel yansımadır; ışın izleme değildir. Şamandıralar ve uzak adalar manzaradır, çarpışma sistemi yoktur.

## Doğrulama

`bun run build` üretim dosyalarını `dist/` klasörüne yazar. `bun run test` hareket ve dalga testlerini çalıştırır. Geliştirme sunucusu açıkken `node tests/smoke.mjs` tarayıcı testini, `node tests/smoke.mjs --webgpu` WebGPU yolunu sınar. Test tarayıcısı kurulumu: `bunx playwright install chromium`.

Kurulum doğrulaması: üretim derlemesi, 4 fizik testi ve Chromium/WebGL2 üzerinde görüntü, gaz, dümen, gece, tekne seçimi, kamera, kalite ve mobil yerleşim testleri geçti. `screenshots/sunset.png` ve `screenshots/night.png` test görüntüleridir. Bu geliştirme ortamında fiziksel GPU erişimi yoktu; zorlanan yazılımsal WebGPU sürücüsü cihaz kaybı verdi. Bu nedenle gerçek GPU üzerindeki WebGPU görüntüsü doğrulanmış sayılmaz. Başarısız sürücü görüntüleri dosya adlarında açıkça işaretlidir.

## Kaynaklar

- [Three.js WaterMesh](https://threejs.org/docs/pages/WaterMesh.html)
- [Three.js WebGPU okyanus örneği](https://threejs.org/examples/webgpu_ocean.html)

Three.js MIT lisanslıdır; lisans metni `node_modules/three/LICENSE` içindedir. Tekne geometrileri, normal haritası, arayüz ve sesler bu proje için üretilmiştir.
