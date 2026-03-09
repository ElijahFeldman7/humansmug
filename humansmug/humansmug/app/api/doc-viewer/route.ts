import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import mammoth from "mammoth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file) {
    return NextResponse.json({ error: "Missing file param" }, { status: 400 });
  }

  // Sanitize — only allow files in public/uploads
  const safeName = path.basename(file);
  const filePath = path.join(process.cwd(), "public", "uploads", safeName);

  try {
    await fs.access(filePath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.convertToHtml({ buffer });
    return NextResponse.json({ html: result.value, filename: safeName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
