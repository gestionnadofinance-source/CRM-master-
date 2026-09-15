import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getServerEnv } from "@/lib/env";

export interface StoredFileRef {
  storageKey: string;
}

export interface StorageDriver {
  put(input: { buffer: Buffer; fileName: string; crmId: string; mimeType: string }): Promise<StoredFileRef>;
  get(storageKey: string): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
  /** URL signée temporaire pour téléchargement direct (S3) — non applicable au driver local. */
  getSignedUrl?(storageKey: string): Promise<string | null>;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

class LocalStorageDriver implements StorageDriver {
  private root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(storageKey: string): string {
    const resolved = path.resolve(this.root, storageKey);
    if (!resolved.startsWith(this.root)) {
      throw new Error("Chemin de stockage invalide.");
    }
    return resolved;
  }

  async put({ buffer, fileName, crmId }: { buffer: Buffer; fileName: string; crmId: string; mimeType: string }) {
    const storageKey = path.posix.join(safeSegment(crmId), `${randomUUID()}-${safeSegment(fileName)}`);
    const fullPath = this.resolve(storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return { storageKey };
  }

  async get(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolve(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    await fs.rm(this.resolve(storageKey), { force: true });
  }
}

class S3StorageDriver implements StorageDriver {
  private bucket: string;
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client>;

  constructor(bucket: string) {
    this.bucket = bucket;
    this.clientPromise = import("@aws-sdk/client-s3").then(({ S3Client }) => {
      const env = getServerEnv();
      return new S3Client({
        region: env.S3_REGION ?? "auto",
        endpoint: env.S3_ENDPOINT,
        credentials:
          env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
            ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
            : undefined,
      });
    });
  }

  async put({ buffer, fileName, crmId, mimeType }: { buffer: Buffer; fileName: string; crmId: string; mimeType: string }) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    const storageKey = `${safeSegment(crmId)}/${randomUUID()}-${safeSegment(fileName)}`;
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: storageKey, Body: buffer, ContentType: mimeType })
    );
    return { storageKey };
  }

  async get(storageKey: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async remove(storageKey: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
  }

  async getSignedUrl(storageKey: string): Promise<string | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.clientPromise;
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }), {
      expiresIn: 300,
    });
  }
}

/**
 * Stockage recommandé sur Vercel : le système de fichiers y est en lecture
 * seule en production (hors /tmp), donc LocalStorageDriver n'y fonctionne
 * jamais. Vercel Blob évite d'avoir à provisionner un bucket S3 externe.
 */
class VercelBlobStorageDriver implements StorageDriver {
  private token: string;
  constructor(token: string) {
    this.token = token;
  }

  async put({ buffer, fileName, crmId }: { buffer: Buffer; fileName: string; crmId: string; mimeType: string }) {
    const { put } = await import("@vercel/blob");
    const storageKey = path.posix.join(safeSegment(crmId), `${randomUUID()}-${safeSegment(fileName)}`);
    // access: "private" — ce sont des documents personnels (fiches de paie,
    // pointages...) : ils ne doivent jamais être accessibles via une URL
    // publique, seulement relus par notre propre API authentifiée.
    const blob = await put(storageKey, buffer, { access: "private", addRandomSuffix: false, token: this.token });
    return { storageKey: blob.pathname };
  }

  async get(storageKey: string): Promise<Buffer> {
    const { get } = await import("@vercel/blob");
    const result = await get(storageKey, { access: "private", token: this.token });
    if (!result?.stream) throw new Error("Document introuvable dans le stockage.");
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async remove(storageKey: string): Promise<void> {
    const { del } = await import("@vercel/blob");
    await del(storageKey, { token: this.token });
  }
}

let driver: StorageDriver | null = null;

export function getStorageDriver(): StorageDriver {
  if (driver) return driver;
  const env = getServerEnv();
  if (env.STORAGE_DRIVER === "s3") {
    if (!env.S3_BUCKET) throw new Error("S3_BUCKET est requis lorsque STORAGE_DRIVER=s3");
    driver = new S3StorageDriver(env.S3_BUCKET);
  } else if (env.STORAGE_DRIVER === "vercel-blob") {
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN est requis lorsque STORAGE_DRIVER=vercel-blob");
    driver = new VercelBlobStorageDriver(env.BLOB_READ_WRITE_TOKEN);
  } else {
    driver = new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
  }
  return driver;
}

/**
 * Supprime un lot de fichiers physiques par leur storageKey, en tolérant
 * l'échec individuel d'un fichier (journalisé, non bloquant) : à utiliser
 * avant toute suppression en base d'une entité dont les Document liés sont
 * supprimés en cascade par Prisma (Client, Prospect, Quote, Appointment...)
 * — sans cet appel préalable, la ligne Document disparaît de la base mais
 * le fichier reste orphelin indéfiniment dans le stockage configuré.
 */
export async function removeStorageKeys(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;
  const driver = getStorageDriver();
  await Promise.all(
    storageKeys.map(async (key) => {
      try {
        await driver.remove(key);
      } catch (err) {
        console.error(`[storage] échec de suppression du fichier ${key}`, err);
      }
    })
  );
}

export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024; // 20 Mo

// image/svg+xml est volontairement exclu : un SVG peut embarquer du
// JavaScript (balise <script>), et ce fichier est ensuite servi "inline"
// par /api/documents/[id] et /api/vault/[id] avec le Content-Type déclaré
// par l'utilisateur — l'accepter permettrait une XSS stockée exécutée sur
// l'origine de l'application (vol de session, requêtes en tant que la
// victime qui ouvre la pièce jointe).
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);
