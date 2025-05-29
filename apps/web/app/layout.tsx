import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";

import "@softmaple/ui/globals.css";
import { Providers } from "@/components/providers";
import { OPENGRAPH_IMAGE_URL, SITE_CONFIG } from "@softmaple/config";

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Softmaple",
  description:
    "Write academic papers with LaTeX-quality output in a modern WYSIWYG editor.",
  openGraph: {
    title: "Softmaple",
    description:
      "Write academic papers with LaTeX-quality output in a modern WYSIWYG editor.",
    url: SITE_CONFIG.DOMAIN,
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
      "Write academic papers with LaTeX-quality output in a modern WYSIWYG editor.",
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
        className={`${fontSans.variable} ${fontMono.variable} font-sans antialiased `}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
