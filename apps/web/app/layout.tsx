import {
  Caveat,
  DM_Sans,
  JetBrains_Mono,
  Playfair_Display,
  Syne,
} from "next/font/google";
import type { Metadata } from "next";

import "@softmaple/ui/globals.css";
import "@softmaple/awareness/styles.css";
import "./design.css";
import { Providers } from "@/components/providers";
import { RedesignProvider } from "@/components/redesign-provider";
import { getRedesignFlags } from "@/lib/redesign-flags";
import { OPENGRAPH_IMAGE_URL, SITE_CONFIG } from "@softmaple/config";

const fontBody = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

const fontDisplay = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
});

const fontUtility = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-utility",
});

/** Editorial serif for the marketing voice; the product shell keeps Syne. */
const fontEditorial = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-editorial",
});

/** Margin-note hand for the annotations that frame the landing page. */
const fontHand = Caveat({
  subsets: ["latin"],
  variable: "--font-marginalia",
});

export const metadata: Metadata = {
  title: "Softmaple",
  description:
    "A durable collaborative workspace for rich text, Markdown, and LaTeX.",
  openGraph: {
    title: "Softmaple",
    description:
      "A durable collaborative workspace for rich text, Markdown, and LaTeX.",
    url: SITE_CONFIG.WEBSITE_URL,
    siteName: "Softmaple",
    images: [
      {
        url: OPENGRAPH_IMAGE_URL,
        width: 1200,
        height: 800,
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Softmaple",
    description:
      "A durable collaborative workspace for rich text, Markdown, and LaTeX.",
    images: [OPENGRAPH_IMAGE_URL],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const flags = getRedesignFlags();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-redesign={String(flags.shell)}
    >
      <body
        className={`${fontBody.variable} ${fontDisplay.variable} ${fontUtility.variable} ${fontEditorial.variable} ${fontHand.variable} font-sans antialiased`}
      >
        <Providers
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          enableColorScheme
        >
          <RedesignProvider flags={flags}>{children}</RedesignProvider>
        </Providers>
      </body>
    </html>
  );
}
