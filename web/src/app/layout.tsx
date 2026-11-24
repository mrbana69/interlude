import type { Metadata } from 'next';
import { Syne, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['600', '700', '800'],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'interlude — dj queue & karaoke',
  description: 'Stage collaborativo e coda musicale in tempo reale per feste ed eventi',
  metadataBase: new URL('https://interlude-five.vercel.app'),
  openGraph: {
    title: 'interlude — dj queue & karaoke',
    description: 'Aggiungi le tue canzoni preferite alla coda della festa in tempo reale',
    url: 'https://interlude-five.vercel.app',
    siteName: 'interlude',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'interlude — dj queue & karaoke',
    description: 'Aggiungi le tue canzoni preferite alla coda della festa in tempo reale',
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎧</text></svg>',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className={`${syne.variable} ${plusJakartaSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="bg-black text-white antialiased min-h-screen selection:bg-white selection:text-black">
        {children}
      </body>
    </html>
  );
}
