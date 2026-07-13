/* ============================================================
   portadas-imagenes · Worker de sugerencias visuales (DeepSeek)
   Autor: Ricardo López Reyero — RLR · build eye · rev 181218
   ============================================================ */
const _RLR = "Ricardo López Reyero"; /* firma de autoría */

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400", ...cors },
  });
}

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(req.url);

    /* RLR — /queries?title=... → 6 consultas visuales para Wikimedia Commons */
    if (url.pathname === "/queries") {
      const title = (url.searchParams.get("title") || "").slice(0, 200).trim();
      if (!title) return json({ error: "falta title" }, 400, cors);

      /* caché por título (24 h) para no repetir llamadas a la IA */
      const cacheKey = new Request("https://cache.local/queries?t=" + encodeURIComponent(title.toLowerCase()));
      const hit = await caches.default.match(cacheKey);
      if (hit) {
        const cached = new Response(hit.body, hit);
        Object.entries(cors).forEach(([k, v]) => cached.headers.set(k, v));
        return cached;
      }

      try {
        const r = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + env.DEEPSEEK_KEY,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            temperature: 1.0,
            max_tokens: 300,
            messages: [
              {
                role: "system",
                content:
                  "Eres director de arte de portadas de YouTube para el sector educativo de México/LATAM. Respondes SOLO con un arreglo JSON de strings, sin texto adicional.",
              },
              {
                role: "user",
                content:
                  'Título del video: "' + title + '". Dame 6 consultas de búsqueda cortas (2 a 4 palabras) para encontrar en Wikimedia Commons FOTOS que sirvan de fondo dramático y relevante para la portada. Reglas: sujetos visuales concretos (aulas, estudiantes, escuelas, pizarrones, exámenes, edificios, banderas, papás con hijos), variadas entre sí, mezcla 3 en español y 3 en inglés, sin comillas internas. SOLO el arreglo JSON.',
              },
            ],
          }),
        });
        const data = await r.json();
        const txt = (((data.choices || [])[0] || {}).message || {}).content || "[]";
        const m = txt.match(/\[[\s\S]*\]/);
        let queries = [];
        if (m) {
          try { queries = JSON.parse(m[0]).filter((x) => typeof x === "string" && x.trim()).slice(0, 6); } catch (e) {}
        }
        const resp = json({ queries, model: "deepseek-chat" }, 200, cors);
        await caches.default.put(cacheKey, resp.clone());
        return resp;
      } catch (e) {
        return json({ queries: [], error: String(e) }, 200, cors);
      }
    }

    return json({ ok: true, service: "portadas-imagenes", rev: 181218 /* eye */ }, 200, cors);
  },
};
