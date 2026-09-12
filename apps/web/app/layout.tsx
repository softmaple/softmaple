import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";

import "@softmaple/ui/globals.css";
import "@softmaple/awareness/styles.css";
import "./design.css";
import { Providers } from "@/components/providers";
import { OPENGRAPH_IMAGE_URL, SITE_CONFIG } from "@softmaple/config";

/**
 * Three registers, three jobs. Serif is what you wrote, sans is what you
 * press, mono is what the machine sees — see `app/design.css`.
 */

/** What you press: every control, label, and form in the product. */
const fontBody = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
});

/**
 * What you wrote. Fraunces carries an optical-size axis, so a single family
 * re-cuts itself between a hero headline and a card title the way a typesetter
 * would — the same thing this product does when it hands a draft to LaTeX.
 */
const fontEditorial = Fraunces({
  axes: ["SOFT", "WONK", "opsz"],
  subsets: ["latin"],
  variable: "--font-editorial",
});

/** What the machine sees: Markdown source, LaTeX, line numbers, status. */
const fontUtility = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-utility",
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontBody.variable} ${fontEditorial.variable} ${fontUtility.variable} font-sans antialiased`}
      >
        <Providers
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          enableColorScheme
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
