import './globals.css';

export const metadata = {
  title: "Alt-Class Finder — Masters' Union",
  description: "Find clash-free alternate sessions across sections A to H for Cohort 7.",
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
