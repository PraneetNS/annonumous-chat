import "./globals.css";

export const metadata = {
  title: "Ephemeral Encrypted Chat",
  description: "Anonymous, ephemeral, end-to-end encrypted chat (MVP)."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

