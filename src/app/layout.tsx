import "./globals.css";
import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { Shell } from "@/components/Identity";

import { BRAND, TAGLINE } from "@/lib/brand";

export const metadata: Metadata = { title: BRAND, description: TAGLINE };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

const inter = DM_Sans({ subsets: ["latin"], variable: "--font-sans", weight: ["400","500","700","900"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400"] });

export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${inter.variable} ${mono.variable}`}><body><Shell>{children}</Shell></body></html>;
}
