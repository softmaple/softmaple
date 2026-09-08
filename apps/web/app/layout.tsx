import { DM_Sans, JetBrains_Mono, Syne } from "next/font/google";
import type { Metadata } from "next";

import "@softmaple/ui/globals.css";
import "@softmaple/awareness/styles.css";
import "./design.css";
import { Providers } from "@/components/providers";
import { FeatureFlagsProvider } from "@/components/system/feature-flags-provider";
import { resolveFeatureFlags } from "@/lib/feature-flags";
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
  // Resolved once per server render and handed to the tree as data, so no
  // client component has to read the environment mid-session.
  const featureFlags = resolveFeatureFlags();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontBody.variable} ${fontDisplay.variable} ${fontUtility.variable} font-sans antialiased`}
      >
        <Providers
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          enableColorScheme
        >
          <FeatureFlagsProvider flags={featureFlags}>
            {children}
          </FeatureFlagsProvider>
        </Providers>
      </body>
    </html>
  );
}
