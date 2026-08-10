import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'speech-score-engine',
  description: 'A dramaturgical-audio workbench for polyvocal speech score.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#101012' }}>{children}</body>
    </html>
  );
}
