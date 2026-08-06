import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Watch Anything",
  description: "Turn a question into a focused radar for useful updates.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
