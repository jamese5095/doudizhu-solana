import type { Metadata } from 'next';
import './globals.css';
import { WalletProviders } from '../providers/WalletProviders';
import { Navbar } from '../components/Navbar';

export const metadata: Metadata = {
  title: '斗地主 · Doudizhu Solana',
  description: '链上斗地主，资金由智能合约托管',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="flex min-h-screen flex-col" style={{ backgroundColor: '#ece7df' }}>
        <WalletProviders>
          <Navbar />
          <main className="flex-1">{children}</main>
        </WalletProviders>
      </body>
    </html>
  );
}
