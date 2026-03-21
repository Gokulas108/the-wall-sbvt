import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Srila Bhaktivinoda Thakura Legacy Wall",
  description: "A Living Wall — every name becomes part of the portrait. Join the 3-Month Fundraising Campaign 2026.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Cookie&family=Dancing+Script:wght@600;700&family=Playfair+Display:wght@700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
