import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";

import "@softmaple/ui/globals.css";
import { Providers } from "@/components/providers";

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
    url: "https://playground.softmaple.ink",
    siteName: "Softmaple",
    images: [
      {
        url: "https://opengraph.b-cdn.net/production/images/81042fbb-a0bb-4798-9182-3136b7577860.png?token=bZ-vFnt2m-OhFa-a0fowx1U6zcej1aVmJrA8shpnZts&height=800&width=1200&expires=33284239252",
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
    images: [
      "https://opengraph.b-cdn.net/production/images/81042fbb-a0bb-4798-9182-3136b7577860.png?token=bZ-vFnt2m-OhFa-a0fowx1U6zcej1aVmJrA8shpnZts&height=800&width=1200&expires=33284239252",
    ],
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
