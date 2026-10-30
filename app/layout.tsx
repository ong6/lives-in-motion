import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Serif, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
/** Book text: captions, notes, running heads and folios. */
const book = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-book" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lives in Motion: Singaporean lives as illustrated books that move",
  description:
    "Singaporean lives as illustrated books that move as you scroll. Every fact is researched and cited by Muse Spark, every plate painted by Muse Image and cut into moving layers by SAM 3.1. Read one, or make a new life.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable} ${book.variable}`}>
      <body>{children}</body>
    </html>
  );
}
