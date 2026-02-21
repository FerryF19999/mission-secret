#!/usr/bin/env node

// This script reads data from our local OpenClaw Gateway
// and pushes it to Convex Mission Control

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);

// --- Config ---
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://determined-pig-729.convex.site";

// --- Helper: POST to Convex HTTP endpoint ---
async function postToConvex(path, data) {
  try {
    const res = await fetch(`${CONVEX_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return await res.json();
  } catch (e) {
    console.error(`POST error:`, e.message);
    return null;
  }
}

// --- 1. Read sessions from file ---
console.log("Syncing sessions...");
const sessionsFile = join(process.env.HOME || "/root", ".openclaw", "agents", "main", "sessions", "sessions.json");
if (existsSync(sessionsFile)) {
  const sessionsData = JSON.parse(readFileSync(sessionsFile, "utf-8"));
  const sessionKeys = Object.keys(sessionsData).slice(0, 10);
  console.log(`Found ${sessionKeys.length} sessions`);
  
  for (const key of sessionKeys) {
    const session = sessionsData[key];
    await postToConvex("/openclaw/event", {
      runId: key,
      action: "info",
      prompt: `Session: ${key}`,
      agentName: "Yuri",
      source: "gateway-sync",
    });
  }
}

// --- 2. Read memory files from workspace ---
console.log("Syncing memories...");
const memoryDir = join(process.env.HOME || "/root", ".openclaw", "workspace", "memory");
if (existsSync(memoryDir)) {
  const files = readdirSync(memoryDir).filter(f => f.endsWith(".md"));
  console.log(`Found ${files.length} memory files`);
  
  for (const file of files.slice(0, 10)) {
    const content = readFileSync(join(memoryDir, file), "utf-8");
    await postToConvex("/openclaw/event", {
      action: "end",
      prompt: file.replace(/\.\w+$/, ""),
      response: content.substring(0, 3000),
      agentName: "Yuri",
      source: "memory-sync",
    });
  }
}

console.log("Sync complete!");
