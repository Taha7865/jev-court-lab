import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JEV Court Lab — See the next move",
  description: "One basketball possession. Track players, reconstruct the court, and ask Jev for a structured decision.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
