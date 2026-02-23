"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210";
const convex = new ConvexReactClient(convexUrl);

export function Providers({ children }: { children: ReactNode }) {
  // NOTE: In some CI/build environments NEXT_PUBLIC_CONVEX_URL may be unset.
  // We provide a safe localhost fallback so `next build` prerenders without crashing.
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
