import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// SF Pro is used on Apple devices through the system stack; Inter is the off-Apple fallback.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vantage · live maritime risk & rerouting",
  description: "Detects live threats to sea freight, ranks them by risk to your shipment, and replans a safer route with an explanation.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-space font-sans text-ink">{children}</body>
    </html>
  );
}
