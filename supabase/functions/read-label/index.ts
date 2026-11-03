// Supabase Edge Function: medicine label photo → structured fields.
// The model only fills in codes from the app's phrase library; it never
// writes Chinese. The browser shows every field for caregiver review.
//
// Secrets (set with `supabase secrets set`):
//   ANTHROPIC_API_KEY  required
//   ACCESS_CODE        optional; if set, callers must send it as x-access-code
//   ALLOWED_ORIGINS    optional; comma-separated, defaults below
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.4.0/helpers/zod";
import { z } from "npm:zod@4.6.7";

const DEFAULT_ORIGINS = [
  "https://evanyilun-byte.github.io",
  "http://localhost:8765",
  "http://localhost:8000",
];
const MAX_IMAGE_BASE64 = 6_000_000; // ~4.5 MB image
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const LabelSchema = z.object({
  readable: z.boolean().describe("false if this is not a medicine label or is too blurry to read"),
  medicine_name: z.string().nullable().describe("Drug name as printed, e.g. Metformin"),
  strength: z.string().nullable().describe("e.g. 500mg"),
  dose_qty: z.number().nullable().describe("Amount per dose, e.g. 1, 2, 0.5"),
  unit: z.enum(["tablet", "capsule", "ml", "sachet", "puff", "drop"]).nullable(),
  frequency: z
    .enum(["OM", "OD", "BD", "TDS", "QDS", "ON", "PRN"])
    .nullable()
    .describe("OM once in the morning, OD once daily, BD twice, TDS three times, QDS four times, ON at night, PRN only when needed"),
  food: z.enum(["AFTER", "BEFORE", "WITH", "NONE"]).describe("NONE if the label says nothing about food"),
  prn_reason: z
    .enum(["PRN_GENERIC", "PRN_PAIN", "PRN_FEVER", "PRN_BREATH", "PRN_GIDDY"])
    .nullable()
    .describe("Only for PRN medicines"),
  warnings: z.array(z.enum(["WARN_DROWSY", "WARN_COMPLETE", "WARN_NO_ALCOHOL", "WARN_WATER", "WARN_SWALLOW"])),
  quantity_supplied: z.number().nullable().describe("Total quantity dispensed, e.g. 60 from '60 TAB'"),
  dispensed_on: z.string().nullable().describe("Dispense date as YYYY-MM-DD"),
  duration_days: z.number().nullable().describe("Only if the label gives a course length, e.g. 'for 5 days'"),
  uncertain_fields: z
    .array(z.enum(["medicine_name", "strength", "dose_qty", "unit", "frequency", "food", "prn_reason", "warnings", "quantity_supplied", "dispensed_on", "duration_days"]))
    .describe("Fields you could not read clearly or had to interpret"),
  instruction_text: z.string().describe("The dosing instruction exactly as printed on the label"),
  notes: z.string().nullable().describe("Anything important that does not fit the fields above"),
});

const SYSTEM = `You read photos of medicine labels from Singapore clinics, polyclinics, hospitals and pharmacies and extract the dosing details into the given schema.

The output is shown to a family caregiver, who checks every field against the label before anything is saved, and is then used to build a daily schedule for an older person. Accuracy matters more than completeness: if a value is not printed or you cannot read it with confidence, return null and list the field in uncertain_fields rather than guessing. Also list a field as uncertain whenever you had to interpret wording, for example mapping "1 tab 2x/day pc" to dose_qty 1, frequency BD, food AFTER.

Common label abbreviations: OM morning, ON at night, OD once daily, BD twice daily, TDS three times daily, QDS four times daily, PRN when needed, PC after food, AC before food, TAB tablet, CAP capsule.

Read only what the label says. Do not add medical advice. Only use the warning codes for warnings actually printed on the label.`;

function corsHeaders(origin: string | null) {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS")?.split(",") ?? DEFAULT_ORIGINS).map((o) => o.trim());
  return {
    "Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "content-type, x-access-code",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, cors);

  const accessCode = Deno.env.get("ACCESS_CODE");
  if (accessCode && req.headers.get("x-access-code") !== accessCode) {
    return json({ error: "wrong_access_code" }, 401, cors);
  }

  let body: { image?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400, cors);
  }
  const { image, mediaType } = body;
  if (typeof image !== "string" || !image) return json({ error: "Missing image" }, 400, cors);
  if (image.length > MAX_IMAGE_BASE64) return json({ error: "Image too large" }, 413, cors);
  if (!MEDIA_TYPES.includes(mediaType as (typeof MEDIA_TYPES)[number])) {
    return json({ error: "Unsupported image type" }, 400, cors);
  }

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: zodOutputFormat(LabelSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as (typeof MEDIA_TYPES)[number], data: image },
            },
            { type: "text", text: "Extract the details from this medicine label." },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return json({ error: "declined" }, 422, cors);
    if (response.stop_reason === "max_tokens") return json({ error: "incomplete" }, 502, cors);

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json({ error: "No result" }, 502, cors);
    const parsed = LabelSchema.safeParse(JSON.parse(text.text));
    if (!parsed.success) return json({ error: "Invalid result" }, 502, cors);
    return json({ label: parsed.data }, 200, cors);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429, cors);
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "server_key" }, 500, cors);
    if (err instanceof Anthropic.APIError) return json({ error: "upstream", status: err.status }, 502, cors);
    console.error(err);
    return json({ error: "server" }, 500, cors);
  }
});
