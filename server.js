// Nirvana Once/Sonra Simulasyon - backend proxy
//
// Bu sunucu, tarayıcıdan (frontend'den) gelen görsel-düzenleme isteklerini
// Gemini / fal.ai / OpenAI (ve ileride YouCam) API'lerine iletir. API anahtarları
// SADECE bu sunucuda (ortam değişkenlerinde) tutulur; tarayıcı koduna hiçbir
// zaman gömülmez. Bu hem güvenlik açısından (anahtarlar "Görünüm Kaynağı" ile
// görülemez) hem de "her şubeden aynı adres" kullanımını mümkün kılar.
//
// Kasıtlı olarak HİÇBİR npm paketi kullanmıyor (sadece Node.js'in kendi
// modülleri) — bu sayede "npm install" adımına ihtiyaç yok, herhangi bir
// standart Node barındırma ortamında (Render, Railway, DigitalOcean App
// Platform, vb.) doğrudan `node server.js` ile çalışır.
//
// Frontend'deki cascade (sırayla deneme) ve "görünür değişiklik yok" kontrolü
// mantığı DEĞİŞMEDİ — sadece her sağlayıcı çağrısı artık doğrudan Google/fal/
// OpenAI'a değil, buradaki /api/... uçlarına gidiyor.

const http = require("http");
const fs = require("fs");
const path = require("path");

// Basitlik için GitHub'a yüklerken alt klasör (public/) gerekmesin diye
// arayüz dosyası artık depo KÖKÜNDE (server.js ile aynı yerde) duruyor.
const PUBLIC_DIR = __dirname;
const PORT = process.env.PORT || 3000;
// Bu dosyalar aynı klasörde ama web'den erişilebilir olmamalı (kaynak kodu/notlar).
const BLOCKED_STATIC_NAMES = new Set(["server.js", "package.json", "package-lock.json", "DEPLOY.md", ".env", ".git"]);

// ---------- küçük yardımcılar ----------
function readJsonBody(req, limitBytes){
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes){
        reject(new Error("İstek gövdesi çok büyük."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e){ reject(new Error("Geçersiz JSON gövdesi.")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname){
  const decodedName = path.basename(decodeURIComponent(pathname));
  if (BLOCKED_STATIC_NAMES.has(decodedName)){
    res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
    return fs.readFile(path.join(PUBLIC_DIR, "Nirvana-Once-Sonra-Simulasyon.html"), (e, d) => res.end(d || ""));
  }
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));
  // dizin dışına çıkmayı (path traversal) engelle
  if (!filePath.startsWith(PUBLIC_DIR)){
    res.writeHead(403); res.end("Forbidden"); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()){
      // eşleşen dosya yoksa ana sayfayı gönder (tek sayfalık uygulama)
      filePath = path.join(PUBLIC_DIR, "Nirvana-Once-Sonra-Simulasyon.html");
    }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err2, data) => {
      if (err2){ res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
}

// ---------- erişim kodu kontrolü ----------
function checkAccessCode(req){
  const required = process.env.APP_ACCESS_CODE;
  if (!required) return true;
  const given = req.headers["x-app-code"];
  return given && given === required;
}

// ---------- Gemini/fal/OpenAI istemci mantığı (frontend'deki ile aynı) ----------
function splitDataUrl(dataUrl){
  const mimeMatch = /^data:([^;]+);/.exec(dataUrl || "");
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const base64 = (dataUrl || "").split(",")[1] || "";
  return { mime, base64 };
}

function findImageInResponse(obj){
  let found = null;
  (function walk(node){
    if (found || !node || typeof node !== "object") return;
    if (Array.isArray(node)){
      for (let i = 0; i < node.length && !found; i++) walk(node[i]);
      return;
    }
    const mime = node.mime_type || node.mimeType;
    const data = node.data;
    if (mime && typeof mime === "string" && mime.indexOf("image/") === 0 && typeof data === "string" && data.length > 100){
      found = { mime, data };
      return;
    }
    if (node.inlineData && node.inlineData.data){
      found = { mime: node.inlineData.mimeType || "image/png", data: node.inlineData.data };
      return;
    }
    for (const k in node){
      if (found) break;
      if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k]);
    }
  })(obj);
  return found;
}

function findTextInResponse(obj){
  const texts = [];
  (function walk(node){
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)){ node.forEach(walk); return; }
    if (typeof node.text === "string" && node.text.trim()) texts.push(node.text.trim());
    for (const k in node){
      if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k]);
    }
  })(obj);
  return texts.join(" / ").slice(0, 220);
}

async function safeJsonFetch(url, opts){
  try {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => null);
    const apiErr = json && json.error && json.error.message;
    return { ok: res.ok && !!json, status: res.status, json, summary: "HTTP " + res.status + (apiErr ? " – " + apiErr : "") };
  } catch (networkErr){
    return { ok: false, status: 0, json: null, summary: "ağ hatası: " + networkErr.message };
  }
}

async function callGeminiEdit(apiKey, model, promptText, beforeDataUrl){
  const { mime, base64 } = splitDataUrl(beforeDataUrl);
  const attempts = [];

  const legacyBody = { contents: [{ parts: [ { text: promptText }, { inline_data: { mime_type: mime, data: base64 } } ] }] };
  const r1 = await safeJsonFetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legacyBody) }
  );
  attempts.push("generateContent → " + r1.summary);
  if (r1.ok){
    const img1 = findImageInResponse(r1.json);
    if (img1) return img1;
    const txt1 = findTextInResponse(r1.json);
    attempts[attempts.length - 1] += " (yanıtta görsel bulunamadı" + (txt1 ? "; model metni: \"" + txt1 + "\"" : "") + ")";
  }

  const interBody = { model, input: [ { type: "image", mime_type: mime, data: base64 }, { type: "text", text: promptText } ] };
  const r2 = await safeJsonFetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions?key=" + encodeURIComponent(apiKey),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(interBody) }
  );
  attempts.push("interactions → " + r2.summary);
  if (r2.ok){
    const img2 = findImageInResponse(r2.json);
    if (img2) return img2;
    const txt2 = findTextInResponse(r2.json);
    attempts[attempts.length - 1] += " (yanıtta görsel bulunamadı" + (txt2 ? "; model metni: \"" + txt2 + "\"" : "") + ")";
  }

  throw new Error(attempts.join("  |  "));
}

async function callFalKontextEdit(apiKey, promptText, beforeDataUrl){
  const appId = "fal-ai/flux-pro/kontext";
  let submitRes;
  try {
    submitRes = await fetch("https://queue.fal.run/" + appId, {
      method: "POST",
      headers: { "Authorization": "Key " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText, image_url: beforeDataUrl, safety_tolerance: "6", output_format: "jpeg" })
    });
  } catch (networkErr){
    throw new Error("fal.ai ağ hatası: " + networkErr.message);
  }

  const submitText = await submitRes.text();
  let submitJson = null;
  try { submitJson = JSON.parse(submitText); } catch (e){ /* aşağıda ele alınacak */ }
  if (!submitRes.ok || !submitJson || !submitJson.request_id){
    const submitErr = submitJson && (submitJson.detail || submitJson.error || submitJson.message);
    throw new Error("fal.ai HTTP " + submitRes.status + (submitErr ? " – " + JSON.stringify(submitErr) : (" – ham yanıt: " + submitText.slice(0, 300))));
  }
  const requestId = submitJson.request_id;

  console.log("[fal] kuyruğa alındı, request_id=" + requestId + " ilk durum=" + (submitJson.status || "?") + " ham=" + submitText.slice(0, 400));

  // fal.ai bazen kendi status_url / response_url alanlarını döndürür — bunlar
  // varsa bizim elle kurduğumuz URL'den daha güvenilir (API sürüm değişikliklerine
  // karşı dayanıklı), o yüzden öncelik onlara veriliyor.
  const statusUrl = submitJson.status_url || ("https://queue.fal.run/" + appId + "/requests/" + requestId + "/status");
  const resultUrl = submitJson.response_url || ("https://queue.fal.run/" + appId + "/requests/" + requestId);
  console.log("[fal] statusUrl=" + statusUrl + " resultUrl=" + resultUrl);
  let status = null;
  const pollStart = Date.now();
  for (let i = 0; i < 75; i++){
    await new Promise((r) => setTimeout(r, 1500));
    const stRes = await fetch(statusUrl, { headers: { "Authorization": "Key " + apiKey } });
    const stText = await stRes.text();
    let stJson = null;
    try { stJson = JSON.parse(stText); } catch (e){ /* aşağıda ele alınacak */ }
    status = stJson && stJson.status;
    if (i % 4 === 0 || status === "COMPLETED" || status === "ERROR" || !stJson){
      console.log("[fal] poll #" + i + " (+" + Math.round((Date.now() - pollStart) / 1000) + "sn) HTTP=" + stRes.status + " durum=" + status + (stJson ? "" : " ham=" + stText.slice(0, 200)));
    }
    if (status === "COMPLETED") break;
    if (status === "ERROR") throw new Error("fal.ai üretim hatası" + (stJson.error ? " – " + JSON.stringify(stJson.error) : ""));
  }
  if (status !== "COMPLETED") throw new Error("fal.ai zaman aşımına uğradı (" + Math.round((Date.now() - pollStart) / 1000) + "sn içinde tamamlanmadı, son durum=" + status + ")");

  const resRes = await fetch(resultUrl, { headers: { "Authorization": "Key " + apiKey } });
  const resJson = await resRes.json().catch(() => null);
  if (resJson && resJson.has_nsfw_concepts && resJson.has_nsfw_concepts.some((f) => f)){
    throw new Error("fal.ai: sonuç içerik güvenliği (nsfw/safety) nedeniyle işaretlendi.");
  }
  const img = resJson && resJson.images && resJson.images[0];
  if (!img || !img.url) throw new Error("fal.ai yanıtında görsel bulunamadı.");

  const imgRes = await fetch(img.url);
  const arrBuf = await imgRes.arrayBuffer();
  const b64 = Buffer.from(arrBuf).toString("base64");
  const mime = imgRes.headers.get("content-type") || "image/jpeg";
  return { mime, data: b64 };
}

async function callOpenAIEdit(apiKey, promptText, beforeDataUrl){
  const { mime, base64 } = splitDataUrl(beforeDataUrl);
  const buf = Buffer.from(base64, "base64");
  const blob = new Blob([buf], { type: mime || "image/png" });

  const fd = new FormData();
  fd.append("model", "gpt-image-1");
  fd.append("image", blob, "before.png");
  fd.append("prompt", promptText);
  fd.append("size", "1024x1024");

  let res, json;
  try {
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey },
      body: fd
    });
    json = await res.json().catch(() => null);
  } catch (networkErr){
    throw new Error("OpenAI ağ hatası: " + networkErr.message);
  }

  const apiErr = json && json.error && json.error.message;
  if (!res.ok || !json) throw new Error("OpenAI HTTP " + res.status + (apiErr ? " – " + apiErr : ""));

  const b64 = json.data && json.data[0] && json.data[0].b64_json;
  if (!b64) throw new Error("OpenAI yanıtında görsel bulunamadı.");
  return { mime: "image/png", data: b64 };
}

// ---------- yönlendirme ----------
const routes = {
  "GET /api/health": async (req, res) => sendJson(res, 200, { ok: true }),

  "GET /api/config": async (req, res) => sendJson(res, 200, {
    requiresAccessCode: !!process.env.APP_ACCESS_CODE,
    gemini: !!process.env.GEMINI_API_KEY,
    fal: !!process.env.FAL_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    youcam: !!(process.env.YOUCAM_CLIENT_ID && process.env.YOUCAM_CLIENT_SECRET)
  }),

  // Sunucunun (artık tarayıcının değil) her sağlayıcının adresine gerçekten
  // ulaşıp ulaşamadığını test eder. Ayarlar panelindeki "Bağlantı Testi Yap"
  // butonu bunu çağırır — antivirüs/eklenti gibi tarayıcı taraflı engeller
  // artık devre dışı kaldığı için burada asıl sınanan, barındırma sağlayıcısının
  // ağının Google/fal/OpenAI'a çıkış izni verip vermediği.
  "GET /api/selftest": async (req, res) => {
    async function probe(url){
      // Bağlantı kurulup HERHANGİ bir HTTP yanıtı (404 dahil) alınması, ağ
      // seviyesinde bu adrese ulaşılabildiğini kanıtlar — 404/403 gibi bir kod
      // burada "engellendi" değil, "sunucuya ulaşıldı ama bu tam adres/yol için
      // bir sayfa yok" anlamına gelir (gerçek API çağrıları farklı bir yol/anahtar
      // kullanıyor). Sadece bağlantının kendisi kurulamazsa (zaman aşımı, DNS,
      // reddedilme, güvenlik duvarı engeli) "ulaşılamıyor" sayıyoruz.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(url, { method: "GET", signal: ctrl.signal });
        return { ok: true, status: res.status };
      } catch (e){
        return { ok: false, detail: e.message || String(e) };
      } finally {
        clearTimeout(t);
      }
    }
    const [gemini, fal, openai] = await Promise.all([
      probe("https://generativelanguage.googleapis.com/"),
      probe("https://queue.fal.run/"),
      probe("https://api.openai.com/")
    ]);
    sendJson(res, 200, { gemini, fal, openai });
  },

  "POST /api/gemini/generate": async (req, res) => {
    if (!checkAccessCode(req)) return sendJson(res, 401, { error: "Geçersiz veya eksik erişim kodu." });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return sendJson(res, 400, { error: "Sunucuda GEMINI_API_KEY tanımlı değil." });
    try {
      const body = await readJsonBody(req, 25 * 1024 * 1024);
      const { model, promptText, beforeDataUrl } = body;
      if (!model || !promptText || !beforeDataUrl) return sendJson(res, 400, { error: "model, promptText, beforeDataUrl gerekli." });
      const img = await callGeminiEdit(apiKey, model, promptText, beforeDataUrl);
      console.log("[gemini] OK model=" + model);
      sendJson(res, 200, img);
    } catch (e){ console.error("[gemini] HATA: " + (e.message || String(e))); sendJson(res, 502, { error: e.message || String(e) }); }
  },

  "POST /api/fal/generate": async (req, res) => {
    if (!checkAccessCode(req)) return sendJson(res, 401, { error: "Geçersiz veya eksik erişim kodu." });
    const apiKey = process.env.FAL_KEY;
    if (!apiKey) return sendJson(res, 400, { error: "Sunucuda FAL_KEY tanımlı değil." });
    console.log("[fal] istek alındı, FAL_KEY uzunluk=" + apiKey.length + " içerik ':' var mı=" + apiKey.includes(":"));
    try {
      const body = await readJsonBody(req, 25 * 1024 * 1024);
      const { promptText, beforeDataUrl } = body;
      if (!promptText || !beforeDataUrl) return sendJson(res, 400, { error: "promptText, beforeDataUrl gerekli." });
      const img = await callFalKontextEdit(apiKey, promptText, beforeDataUrl);
      console.log("[fal] OK");
      sendJson(res, 200, img);
    } catch (e){ console.error("[fal] HATA: " + (e.message || String(e))); sendJson(res, 502, { error: e.message || String(e) }); }
  },

  "POST /api/openai/generate": async (req, res) => {
    if (!checkAccessCode(req)) return sendJson(res, 401, { error: "Geçersiz veya eksik erişim kodu." });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return sendJson(res, 400, { error: "Sunucuda OPENAI_API_KEY tanımlı değil." });
    try {
      const body = await readJsonBody(req, 25 * 1024 * 1024);
      const { promptText, beforeDataUrl } = body;
      if (!promptText || !beforeDataUrl) return sendJson(res, 400, { error: "promptText, beforeDataUrl gerekli." });
      const img = await callOpenAIEdit(apiKey, promptText, beforeDataUrl);
      console.log("[openai] OK");
      sendJson(res, 200, img);
    } catch (e){ console.error("[openai] HATA: " + (e.message || String(e))); sendJson(res, 502, { error: e.message || String(e) }); }
  },

  "POST /api/youcam/generate": async (req, res) => {
    if (!checkAccessCode(req)) return sendJson(res, 401, { error: "Geçersiz veya eksik erişim kodu." });
    if (!process.env.YOUCAM_CLIENT_ID || !process.env.YOUCAM_CLIENT_SECRET){
      return sendJson(res, 400, { error: "YouCam henüz yapılandırılmadı (YOUCAM_CLIENT_ID / YOUCAM_CLIENT_SECRET eksik)." });
    }
    return sendJson(res, 501, { error: "YouCam entegrasyonu henüz eklenmedi — API anahtarı alındıktan sonra tamamlanacak." });
  }
};

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, "http://localhost");
  const key = req.method + " " + urlObj.pathname;
  const handler = routes[key];
  if (handler){
    handler(req, res).catch((e) => sendJson(res, 500, { error: "Sunucu hatası: " + (e.message || String(e)) }));
    return;
  }
  if (req.method === "GET"){
    serveStatic(req, res, urlObj.pathname);
    return;
  }
  sendJson(res, 404, { error: "Bulunamadı." });
});

server.listen(PORT, () => {
  console.log("Nirvana sunucu " + PORT + " portunda çalışıyor.");
});
