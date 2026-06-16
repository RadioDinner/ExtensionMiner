import "./globals.css";

export const metadata = {
  title: "ExtensionMiner — Opportunity Dashboard",
  description: "Chrome Web Store extensions worth building a competitor against.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
