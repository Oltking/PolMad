/// Logo agent.
///
/// Groq serves text models only — there is no image generation available on this
/// key. So rather than fake it, the agent writes **SVG markup**, which we then
/// rasterise to a real 512x512 PNG. That is a genuine constraint with a genuine
/// consequence: this produces strong geometric/abstract marks (the dominant style
/// for token logos anyway), not illustration or lettering-heavy artwork.
///
/// The SVG is validated and sanitised before it is ever rendered — model output is
/// untrusted input, and SVG is an executable format.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You design minimal, iconic token logos as raw SVG.

Output rules — these are absolute:
- Reply with ONLY the SVG markup. No markdown fences, no commentary, no explanation.
- Root element must be: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
- Allowed elements ONLY: svg, g, defs, linearGradient, radialGradient, stop, path,
  circle, ellipse, rect, polygon, polyline, line, text, tspan.
- NEVER use: script, foreignObject, image, use, animate, filter, style, or any
  attribute starting with "on".
- Draw a full-bleed background shape (rect or circle covering the canvas) so the
  logo works on any page background.

Design rules:
- One strong idea. A crypto logo is read at 32px in a wallet list — it must survive that.
- 2 to 4 colours maximum. High contrast between mark and background.
- Bold geometry: thick strokes, large shapes, generous negative space.
- At most 2 letters of text, and only if the ticker is genuinely 1-2 characters.
  Prefer an abstract mark over lettering.
- No gradients spanning more than two stops. No drop shadows. No fine detail.`;

export interface LogoResult {
  svg: string;
  model: string;
  /// True when the model failed and a deterministic mark was generated instead.
  fallbackUsed: boolean;
}

/// Elements and attributes we will render. Anything else is stripped — an SVG can
/// carry script, external fetches, and event handlers, and this one is written by
/// a model responding to text a stranger typed.
const ALLOWED_TAGS = new Set([
  "svg", "g", "defs", "lineargradient", "radialgradient", "stop", "path", "circle",
  "ellipse", "rect", "polygon", "polyline", "line", "text", "tspan", "title",
]);

const FORBIDDEN_ATTR = /^(on|xlink:|href$|src$|style$)/i;

export function sanitizeSvg(raw: string): string | null {
  // Strip fences and any prose the model added despite instructions.
  const match = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return null;
  let svg = match[0];

  // Hard rejects: these should never survive, so bail rather than try to clean.
  if (/<\s*(script|foreignObject|iframe|image|use|animate|set|filter|style)\b/i.test(svg)) {
    return null;
  }
  if (/\b(javascript:|data:text\/html)/i.test(svg)) return null;

  // Drop any element not on the allow-list.
  svg = svg.replace(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g, (whole, tag: string, attrs: string) => {
    if (!ALLOWED_TAGS.has(tag.toLowerCase())) return "";
    // Drop event handlers, external references, and inline styles.
    const cleaned = attrs.replace(/\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, (attrWhole, name: string) =>
      FORBIDDEN_ATTR.test(name) ? "" : attrWhole,
    );
    return whole.startsWith("</") ? `</${tag}>` : `<${tag}${cleaned}>`;
  });

  // Force a known-good viewBox so the raster is always square and complete.
  svg = svg.replace(/<svg([^>]*)>/i, (_m, attrs: string) => {
    const keep = attrs.replace(/\s(viewBox|width|height|xmlns)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"${keep}>`;
  });

  return svg.includes("</svg>") ? svg : null;
}

export async function generateLogo(
  name: string,
  symbol: string,
  brief: string,
): Promise<LogoResult> {
  const apiKey = process.env.GROQ_API_KEY;
  const fallback = { svg: deterministicMark(name, symbol), model: "deterministic", fallbackUsed: true };
  if (!apiKey) return fallback;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.85, // higher than the report path: here we want variety
        max_tokens: 1600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Token name: ${name}\nTicker: ${symbol}\nDirection: ${brief || "clean, modern, memorable"}\n\nOutput the SVG.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return fallback;

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? "";
    const svg = sanitizeSvg(text);
    if (!svg) return fallback;

    return { svg, model: MODEL, fallbackUsed: false };
  } catch {
    return fallback;
  }
}

/// Deterministic fallback mark, derived from the token name so it is stable across
/// retries. Never blocks a launch on the model being unavailable.
export function deterministicMark(name: string, symbol: string): string {
  let hash = 0;
  for (const ch of name + symbol) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

  const hue = hash % 360;
  const bg = `hsl(${hue} 70% 12%)`;
  const fg = `hsl(${(hue + 40) % 360} 90% 60%)`;
  const initials = (symbol || name).slice(0, 2).toUpperCase();

  // Rotating geometric motif so different tokens don't all look identical.
  const motif = [
    `<circle cx="256" cy="256" r="150" fill="none" stroke="${fg}" stroke-width="44"/>`,
    `<rect x="118" y="118" width="276" height="276" fill="none" stroke="${fg}" stroke-width="44"/>`,
    `<polygon points="256,96 416,384 96,384" fill="none" stroke="${fg}" stroke-width="44"/>`,
    `<path d="M120 392 L256 120 L392 392" fill="none" stroke="${fg}" stroke-width="44" stroke-linecap="square"/>`,
  ][hash % 4];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${bg}"/>${motif}<text x="256" y="286" font-family="monospace" font-size="112" font-weight="bold" fill="${fg}" text-anchor="middle">${escapeXml(initials)}</text></svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );
}
