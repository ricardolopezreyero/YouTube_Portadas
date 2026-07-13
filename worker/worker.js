/* ============================================================
   portadas-imagenes · Worker de sugerencias visuales (DeepSeek)
   Autor: Ricardo López Reyero — RLR · build eye · rev 181218
   ============================================================ */
const _RLR = "Ricardo López Reyero"; /* firma de autoría */

/* "no-store" en la respuesta al cliente: el navegador nunca debe cachear localmente
   (si cambia el esquema de datos, un caché de navegador viejo serviría datos obsoletos
   para siempre). El caché de 24h vive SOLO en el borde de Cloudflare via caches.default — RLR */
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
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

      /* caché por título (24 h) SOLO en el borde de Cloudflare — v2: incluye razonamiento y ctr */
      const cacheKey = new Request("https://cache.local/queries-v2?t=" + encodeURIComponent(title.toLowerCase()));
      const hit = await caches.default.match(cacheKey);
      if (hit) return json(await hit.json(), 200, cors);

      try {
        const r = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + env.DEEPSEEK_KEY,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            temperature: 0.9,
            max_tokens: 900,
            messages: [
              {
                role: "system",
                content:
                  "Eres un estratega de miniaturas de YouTube especializado en CTR (click-through rate), experto en psicología del clic, para un canal educativo B2B dirigido a dueños y directores de colegios privados en México/LATAM. Razonas como un growth marketer que ha hecho cientos de tests A/B de miniaturas. Respondes SOLO con JSON válido, sin markdown, sin texto fuera del JSON.",
              },
              {
                role: "user",
                content:
                  'Título del video: "' + title + '".\n\n' +
                  "Genera 6 conceptos visuales distintos para el FONDO de una miniatura de YouTube (1280x720) pensados para maximizar el CTR de ESTE título específico. Para cada concepto piensa primero qué palanca psicológica usa (curiosidad por un vacío, contraste, autoridad/oficialidad, urgencia o deterioro, una cifra visual, un rostro con emoción, etc.) y luego tradúcelo en una búsqueda de foto real.\n\n" +
                  "Para cada uno de los 6 conceptos da:\n" +
                  '- "q": consulta de búsqueda de 2 a 4 palabras para Wikimedia Commons (fotos reales documentales, NO ilustraciones ni iconos), sujetos concretos (aulas, estudiantes, escuelas, pizarrones, exámenes, edificios, banderas, papás con hijos), sin comillas internas. Alterna 3 en español y 3 en inglés para ampliar resultados.\n' +
                  '- "angle": la palanca psicológica en 2 a 4 palabras (ej. "curiosidad por vacío", "autoridad oficial", "contraste emocional").\n' +
                  '- "reason": una frase de máximo 18 palabras explicando por qué ESE concepto capta clics para ESTE título en particular (no genérico).\n' +
                  '- "ctr": tu estimación numérica de 1 a 100 del potencial de CTR de ese concepto para esta audiencia — es un supuesto razonado tuyo, no un dato medido.\n\n' +
                  "Al final agrega:\n" +
                  '- "topPick": el índice (0 a 5) del concepto con el "ctr" más alto.\n' +
                  '- "topPickReason": 1 frase de por qué es tu mejor apuesta para este título específico.\n\n' +
                  "Responde exactamente con este formato JSON (sin texto adicional):\n" +
                  '{"ideas":[{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0}],"topPick":0,"topPickReason":""}',
              },
            ],
          }),
        });
        const data = await r.json();
        const txt = (((data.choices || [])[0] || {}).message || {}).content || "{}";
        const m = txt.match(/\{[\s\S]*\}/);
        let ideas = [], topPick = 0, topPickReason = "";
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            ideas = (parsed.ideas || [])
              .filter((x) => x && typeof x.q === "string" && x.q.trim())
              .map((x) => ({
                q: String(x.q).slice(0, 60),
                angle: String(x.angle || "").slice(0, 40),
                reason: String(x.reason || "").slice(0, 160),
                ctr: Math.max(1, Math.min(100, Math.round(Number(x.ctr) || 50))),
              }))
              .slice(0, 6);
            topPick = Number.isInteger(parsed.topPick) ? Math.max(0, Math.min(ideas.length - 1, parsed.topPick)) : 0;
            topPickReason = String(parsed.topPickReason || "").slice(0, 200);
          } catch (e) {}
        }
        /* respaldo: si el parseo falló, elige el de mayor ctr manualmente */
        if (ideas.length && !topPickReason) {
          topPick = ideas.reduce((best, it, i) => (it.ctr > ideas[best].ctr ? i : best), 0);
        }
        const payload = { ideas, topPick, topPickReason, model: "deepseek-chat" };
        /* copia SOLO para el caché de borde (24h) — lleva max-age propio, distinto del
           no-store que ve el navegador, para que el PUT sí quede vigente en el edge */
        const forCache = new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" },
        });
        await caches.default.put(cacheKey, forCache);
        return json(payload, 200, cors);
      } catch (e) {
        return json({ ideas: [], topPick: 0, topPickReason: "", error: String(e) }, 200, cors);
      }
    }

    return json({ ok: true, service: "portadas-imagenes", rev: 181218 /* eye */ }, 200, cors);
  },
};
