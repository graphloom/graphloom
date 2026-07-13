import type { ReactNode } from 'react';

export const metadata = { title: 'GraphLoom Next smoke' };

/** Root layout — a Server Component (no 'use client' anywhere in this app). */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
