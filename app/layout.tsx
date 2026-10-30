import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Instrument_Serif, Newsreader } from "next/font/google";
import "./globals.css";

const sans = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
/** Book text: captions, notes, running heads and folios. */
const book = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"], variable: "--font-book" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Lives in Motion — Singapore lives, drawn and told decade by decade",
  description:
    "Scroll through the lives of Jack Sim, Lee Kuan Yew and Joseph Schooling. Every scene is sourced, illustrated with Meta's Muse Image and animated with SAM 3.1 cut-outs and single-line Fourier drawings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable} ${book.variable}`}>
      <body>{children}</body>
    </html>
  );
}
