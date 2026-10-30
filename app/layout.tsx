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

/**
 * Recording mode, for screen captures: open any page with ?record (or ?record=1) and it sticks
 * for the session's later pages; ?record=0 turns it off. It sets data-recording on <html>, which
 * hides the Next dev badge and anything marked data-record-hide (app/globals.css).
 */
const RECORDING = `try{var q=new URLSearchParams(location.search).get("record");if(q!==null)sessionStorage.setItem("lim-record",q==="0"?"":"1");if(sessionStorage.getItem("lim-record"))document.documentElement.setAttribute("data-recording","")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable} ${book.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RECORDING }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
