import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConnectSphere",
  description: "Event lifecycle management platform: request, coordination, venue and equipment booking, and attendee registration.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
