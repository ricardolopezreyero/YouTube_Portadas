/* ============================================================
   portadas-imagenes · Worker de sugerencias visuales y de título (DeepSeek)
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

/* llamada compartida a DeepSeek: manda system+user, devuelve el primer objeto {...}
   que encuentre en la respuesta ya parseado, o null si algo falla — RLR */
async function callDeepSeek(env, system, user, opts) {
  opts = opts || {};
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.DEEPSEEK_KEY },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: opts.temperature != null ? opts.temperature : 0.65,
      max_tokens: opts.maxTokens || 900,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await r.json();
  const txt = (((data.choices || [])[0] || {}).message || {}).content || "{}";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

/* caché de borde (24h) por clave — separado del "no-store" que ve el navegador — RLR */
async function cachedJson(cacheKey, compute) {
  const hit = await caches.default.match(cacheKey);
  if (hit) return await hit.json();
  const payload = await compute();
  const forCache = new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
  await caches.default.put(cacheKey, forCache);
  return payload;
}

const SYSTEM_QUERIES =
  "Eres un estratega de miniaturas de YouTube especializado en CTR (click-through rate), experto en psicología del clic, para un canal educativo B2B dirigido a dueños y directores de colegios privados en México/LATAM. Razonas como un growth marketer que ha hecho cientos de tests A/B de miniaturas. Respondes SOLO con JSON válido, sin markdown, sin texto fuera del JSON.";

function buildQueriesPrompt(title) {
  return (
    'Título del video: "' + title + '".\n\n' +
    "Genera 6 conceptos visuales distintos para el FONDO de una miniatura de YouTube (1280x720) pensados para maximizar el CTR de ESTE título específico. Para cada concepto piensa primero qué palanca psicológica usa (curiosidad por un vacío, contraste, autoridad/oficialidad, urgencia o deterioro, una cifra visual, un rostro con emoción, etc.) y luego tradúcelo en una búsqueda de foto real.\n\n" +
    "Para cada uno de los 6 conceptos da:\n" +
    '- "q": consulta de búsqueda de 2 a 4 palabras para Wikimedia Commons.\n' +
    "  REGLA CRÍTICA: Wikimedia Commons hace búsqueda LITERAL de texto (no entiende metáforas ni conceptos abstractos). Una consulta como \"broken classroom\" o \"deterioro educativo\" o \"poor children studying\" NO encuentra fotos de aulas — encuentra basura semántica (documentos antiguos, pinturas, música) porque Commons empareja las palabras sueltas donde sea que aparezcan, sin entender la intención.\n" +
    "  Por eso cada \"q\" debe ser 100% literal y fotografiable: combina como máximo UN adjetivo simple (vacío, lleno, antiguo, moderno, uniformado) con al menos un SUSTANTIVO ESCOLAR CONCRETO de esta lista o similar: aula, salón de clases, escuela, pizarrón, pupitres, uniforme escolar, examen, patio escolar, edificio escolar, bandera México, estudiantes, maestro, mochila, útiles escolares, graduación, director, oficina, biblioteca, classroom, students, school building, desks, chalkboard, backpack, exam paper, teacher, playground.\n" +
    '  Ejemplos BUENOS: "aula vacía pupitres", "salón clases lleno estudiantes", "niños uniforme escolar México", "empty classroom desks", "students exam classroom", "school building Mexico flag", "maestro pizarrón clase".\n' +
    '  Ejemplos MALOS (nunca hagas esto): "broken classroom Mexico", "deterioro educativo", "poor children studying", "urgencia escolar", "crisis educativa" — son abstractos y traen fotos irrelevantes.\n' +
    "  Sin comillas internas. Alterna 3 en español y 3 en inglés para ampliar resultados.\n" +
    '- "angle": la palanca psicológica en 2 a 4 palabras (ej. "curiosidad por vacío", "autoridad oficial", "contraste emocional") — aquí SÍ puedes ser abstracto, esto no se busca en Commons, solo describe la estrategia.\n' +
    '- "reason": una frase de máximo 18 palabras explicando por qué ESE concepto capta clics para ESTE título en particular (no genérico).\n' +
    '- "ctr": tu estimación numérica de 1 a 100 del potencial de CTR de ese concepto para esta audiencia — es un supuesto razonado tuyo, no un dato medido.\n\n' +
    "Al final agrega:\n" +
    '- "topPick": el índice (0 a 5) del concepto con el "ctr" más alto.\n' +
    '- "topPickReason": 1 frase de por qué es tu mejor apuesta para este título específico.\n\n' +
    "Responde exactamente con este formato JSON (sin texto adicional):\n" +
    '{"ideas":[{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0},{"q":"","angle":"","reason":"","ctr":0}],"topPick":0,"topPickReason":""}'
  );
}

const SYSTEM_TITLES =
  'Eres un editor de títulos de YouTube para un canal educativo B2B dirigido a dueños y directores de colegios privados en México/LATAM (marca SuperLeads). Sabes marcar con *asteriscos* la frase de un título que más urgencia o curiosidad genera, y sabes proponer títulos alternativos con el mismo gancho directo y basado en datos que usa la marca. Respondes SOLO con JSON válido, sin markdown, sin texto fuera del JSON.';

function buildTitlesPrompt(title) {
  return (
    'Título original (texto plano, sin resaltar): "' + title + '"\n\n' +
    "TAREA 1 — ÉNFASIS: Devuelve el título ORIGINAL completo, con el texto IDÉNTICO palabra por palabra (no cambies ni corrijas nada), pero encierra entre *asteriscos* la frase de 2 a 5 palabras que más urgencia/curiosidad genera dentro de ese mismo texto. Dame 2 versiones: cada una debe resaltar una frase DIFERENTE del título (nunca repitas la misma frase en las dos).\n\n" +
    "TAREA 2 — ALTERNATIVAS: Dame 4 títulos ALTERNATIVOS (con texto distinto al original, no lo repitas) que traten el MISMO tema y ángulo que el título original pero con otra redacción — mismo estilo directo, con gancho de curiosidad, dirigido a dueños y directores de colegios privados. Máximo 90 caracteres cada uno. Marca también con *asteriscos* la frase más importante de cada alternativa.\n\n" +
    "Responde exactamente con este formato JSON (sin texto adicional):\n" +
    '{"highlights":["",""],"alternatives":["","","",""]}'
  );
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

      /* IMPORTANTE: sube este número de versión cada vez que cambie el prompt o el
         esquema de respuesta — si no, títulos ya cacheados sirven resultados viejos
         hasta por 24h aunque el código ya esté corregido (nos pasó con "-v2"). */
      const cacheKey = new Request("https://cache.local/queries-v4?t=" + encodeURIComponent(title.toLowerCase()));
      try {
        const payload = await cachedJson(cacheKey, async () => {
          const parsed = await callDeepSeek(env, SYSTEM_QUERIES, buildQueriesPrompt(title), { temperature: 0.65, maxTokens: 900 });
          let ideas = [], topPick = 0, topPickReason = "";
          if (parsed) {
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
          }
          if (ideas.length && !topPickReason) {
            topPick = ideas.reduce((best, it, i) => (it.ctr > ideas[best].ctr ? i : best), 0);
          }
          return { ideas, topPick, topPickReason, model: "deepseek-chat" };
        });
        return json(payload, 200, cors);
      } catch (e) {
        return json({ ideas: [], topPick: 0, topPickReason: "", error: String(e) }, 200, cors);
      }
    }

    /* RLR — /titles?title=... → 2 versiones con énfasis + 4 alternativas que hacen match */
    if (url.pathname === "/titles") {
      const raw = (url.searchParams.get("title") || "").slice(0, 200).trim();
      if (!raw) return json({ error: "falta title" }, 400, cors);
      const cleanTitle = raw.replace(/\*/g, "");

      /* misma nota de versión que /queries: subir si cambia el prompt/esquema */
      const cacheKey = new Request("https://cache.local/titles-v1?t=" + encodeURIComponent(cleanTitle.toLowerCase()));
      try {
        const payload = await cachedJson(cacheKey, async () => {
          const parsed = await callDeepSeek(env, SYSTEM_TITLES, buildTitlesPrompt(cleanTitle), { temperature: 0.8, maxTokens: 600 });
          let highlights = [], alternatives = [];
          if (parsed) {
            highlights = (parsed.highlights || [])
              .filter((x) => typeof x === "string" && x.trim())
              .map((x) => String(x).slice(0, 160))
              .slice(0, 2);
            alternatives = (parsed.alternatives || [])
              .filter((x) => typeof x === "string" && x.trim())
              .map((x) => String(x).slice(0, 160))
              .slice(0, 4);
          }
          /* respaldo: si la IA no devolvió énfasis válido, usa el título tal cual */
          if (!highlights.length) highlights = [cleanTitle, cleanTitle];
          return { highlights, alternatives, model: "deepseek-chat" };
        });
        return json(payload, 200, cors);
      } catch (e) {
        return json({ highlights: [], alternatives: [], error: String(e) }, 200, cors);
      }
    }

    return json({ ok: true, service: "portadas-imagenes", rev: 181218 /* eye */ }, 200, cors);
  },
};
