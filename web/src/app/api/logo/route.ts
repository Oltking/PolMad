import sharp from "sharp";
import { generateLogo, deterministicMark, sanitizeSvg } from "@/lib/logoAgent";

/// POST /api/logo  { name, symbol, brief }
/// Returns SVG plus a 512x512 PNG data URI, ready to download or pin.
///
/// Rate-limited per IP: this endpoint costs money (model tokens) and CPU
/// (rasterising), and it is unauthenticated by design so creators can try it
/// before connecting a wallet.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local";

  if (rateLimited(ip)) {
    return Response.json({ error: "Too many logo requests. Wait a minute." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 64);
  const symbol = String(body?.symbol ?? "").trim().slice(0, 12);
  const brief = String(body?.brief ?? "").trim().slice(0, 300);
  // Lets the user tweak a generated SVG and re-rasterise without another model call.
  const providedSvg = typeof body?.svg === "string" ? body.svg : null;

  if (!name && !symbol) {
    return Response.json({ error: "Provide a name or symbol" }, { status: 400 });
  }

  try {
    let svg: string;
    let model: string;
    let fallbackUsed: boolean;

    if (providedSvg) {
      const clean = sanitizeSvg(providedSvg);
      if (!clean) return Response.json({ error: "SVG rejected by sanitiser" }, { status: 400 });
      svg = clean;
      model = "user-supplied";
      fallbackUsed = false;
    } else {
      const result = await generateLogo(name, symbol, brief);
      svg = result.svg;
      model = result.model;
      fallbackUsed = result.fallbackUsed;
    }

    let png: Buffer;
    try {
      png = await sharp(Buffer.from(svg)).resize(512, 512, { fit: "cover" }).png().toBuffer();
    } catch {
      // The model produced SVG that survived sanitising but sharp cannot render
      // (bad path data, malformed numbers). Fall back rather than fail the user.
      svg = deterministicMark(name, symbol);
      png = await sharp(Buffer.from(svg)).resize(512, 512).png().toBuffer();
      model = "deterministic";
      fallbackUsed = true;
    }

    return Response.json({
      svg,
      png: `data:image/png;base64,${png.toString("base64")}`,
      model,
      fallbackUsed,
      size: 512,
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
