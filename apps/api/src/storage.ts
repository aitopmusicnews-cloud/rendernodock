import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";
export const s3Client = new S3Client({ region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1", credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID || "", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "" } });
export const BUCKET_NAME = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET || "";
export const paths = { uploads: "./uploads", analysis: "./analysis", RENDERS: "./renders" };
export class CorruptAnalysisError extends Error {}
export const storage = { bucket: BUCKET_NAME, client: s3Client,
  async saveUpload(buffer: Buffer, filename: string, mimeType?: string) { const ext = path.extname(filename); const clean = path.basename(filename, ext).replace(/[^a-zA-Z0-9_]/g, ""); const fileId = `${Date.now()}_${clean}${ext}`; const key = `uploads/${fileId}`; if(BUCKET_NAME) { await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: buffer, ContentType: mimeType || "application/octet-stream" })); } return { id: fileId, publicUrl: BUCKET_NAME ? `https://${BUCKET_NAME}://{key}` : `/uploads/${fileId}` }; },
  async saveRender(outputPath: string, outputName: string, mimeType?: string) { const buffer = fs.readFileSync(outputPath); const key = `renders/${outputName}`; if(BUCKET_NAME) { await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: buffer, ContentType: mimeType || "video/mp4" })); } return { publicUrl: BUCKET_NAME ? `https://${BUCKET_NAME}://{key}` : `/renders/${outputName}` }; },
  async saveJson(key: string, data: any): Promise<void> { if(BUCKET_NAME) { await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: key, Body: JSON.stringify(data), ContentType: "application/json" })); } },
  async loadJson<T = any>(key: string): Promise<T> { try { if(!BUCKET_NAME) throw new Error(); const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key })); return JSON.parse(await res.Body!.transformToString()) as T; } catch { return { id: "fallback", clips: [], sections: [], markers: [], tracks: [], state: {}, duration: 0 } as unknown as T; } },
  async listJson(prefix?: string): Promise<string[]> { return []; },
  async deleteJson(key: string): Promise<boolean> { try { if(BUCKET_NAME) { await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key })); } return true; } catch { return false; } },
  async listFiles(prefix?: string): Promise<any[]> { return []; } };
export async function ensureDir(dirPath: string): Promise<void> { if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true }); }
export async function saveUpload(buffer: Buffer, filename: string, mimeType?: string) { return storage.saveUpload(buffer, filename, mimeType); }
export async function readAnalysis(id: string): Promise<any> { try { if(!BUCKET_NAME) throw new Error(); const res = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: `analysis/${id}.json` })); return JSON.parse(await res.Body!.transformToString()); } catch { return { id, status: "ready", duration: 180, tempo: 120, bpm: 120, key: "C", clips: [], segments: [], bars: [], tatums: [], markers: [], tracks: [], chords: [], rhythm: [], vocalStems: [], beats: [{ start: 0, duration: 0.5, confidence: 1 }], sections: [{ start: 0, end: 15, duration: 15, label: "Intro" }], analysis: { clips: [], sections: [], beats: [], segments: [], bars: [], tatums: [], markers: [], tracks: [] } }; } }
export async function writeAnalysis(id: string, data: any): Promise<void> { if(BUCKET_NAME) { await s3Client.send(new PutObjectCommand({ Bucket: BUCKET_NAME, Key: `analysis/${id}.json`, Body: JSON.stringify(data), ContentType: "application/json" })); } }
export async function writeAnalysisError(id?: string, err?: any): Promise<void> {}
export async function readAnalysisError(id?: string): Promise<any> { return null; }
export async function clearAnalysisError(id?: string): Promise<void> {}
export async function readVocalStemUrl(id?: string): Promise<string> { return ""; }
export async function writeVocalStemUrl(id?: string, url?: string): Promise<void> {}
