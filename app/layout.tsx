import type { Metadata } from 'next';
import { Lexend_Deca, Tilt_Warp } from 'next/font/google';
import './globals.css';

const lexend = Lexend_Deca({ variable: '--font-lexend', subsets: ['latin'] });
const tiltWarp = Tilt_Warp({ variable: '--font-tilt', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Curio Menu Generator',
  description: 'Create Curio daily menus for Instagram Stories and the restaurant TV.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${lexend.variable} ${tiltWarp.variable}`}>{children}</body></html>;
}
