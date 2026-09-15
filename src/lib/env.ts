import { z } from "zod";

/**
 * Validation centralisée des variables d'environnement serveur.
 * Ne jamais importer ce module depuis un composant client : les secrets
 * (SMTP, Pusher secret, DATABASE_URL...) ne doivent jamais atteindre le
 * bundle navigateur.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  APP_URL: z.string().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("crm_master_session"),
  SESSION_TTL_HOURS: z.coerce.number().default(12),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("CRM Master <no-reply@crm-master.local>"),
  SMTP_SECURE: z.coerce.boolean().default(false),

  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3", "vercel-blob"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage/uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Variables d'environnement invalides: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ")}`
    );
  }
  cached = parsed.data;
  return cached;
}

export function isEmailConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD);
}

export function isRealtimeConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET && env.PUSHER_CLUSTER);
}

export { publicEnv } from "@/lib/public-env";
