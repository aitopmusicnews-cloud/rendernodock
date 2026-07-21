// @ts-ignore
import { S3Client } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

export const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

export const BUCKET_NAME = process.env.AWS_S3_BUCKET || "";

export const paths = {
  uploads: "./uploads",
  analysis: "./analysis",
  RENDERS: "./renders"
};

export class CorruptAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptAnalysisError";
  }
}

// Fixed property type to string to satisfy src/projects.ts mapping requirements
interface StorageFile {
  key: string;
  publicUrl: string;
  size: number;
  modifiedAt: string; 
}

export const storage = {
  bucket: BUCKET_NAME,
  client: s3Client,

  async saveUpload(buffer: Buffer, filename: string, mimeType?: string) {
    const safeName = filename.replace(/[^a-zA-Z0-9.]/g, "_");
    const fileId = `${Date.now()}_${safeName}`;
    return {
      id: fileId,
      publicUrl: `/uploads/${fileId}`
    };
  },

  async saveRender(outputPath: string, outputName: string, mimeType?: string) {
    return {
      publicUrl: `/renders/${outputName}`
    };
  },

  async saveJson(key: string, data: any): Promise<void> {},
  async loadJson<T = any>(key: string): Promise<T> {
    return {} as T;
  },
  async listJson(prefix: string): Promise<string[]> {
    return [];
  },
  async deleteJson(key: string): Promise<boolean> {
    return true;
  },
  
  async listFiles(prefix: string): Promise<StorageFile[]> {
    return [];
  }
};

export async function ensureDir(dirPath: string): Promise<void> {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function saveUpload(buffer: Buffer, filename: string, mimeType?: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9.]/g, "_");
  const fileId = `${Date.now()}_${safeName}`;
  return {
    id: fileId,
    publicUrl: `/uploads/${fileId}`
  };
}

export async function readAnalysis(id: string): Promise<any> {
  return { id, status: "ready" };
}

export async function writeAnalysis(id: string, data: any): Promise<void> {}
export async function writeAnalysisError(id: string, error: any): Promise<void> {}
export async function readAnalysisError(id: string): Promise<any> { return null; }
export async function clearAnalysisError(id: string): Promise<void> {}
export async function readVocalStemUrl(id: string): Promise<string> { return ""; }
export async function writeVocalStemUrl(id: string, url: string): Promise<void> {}
