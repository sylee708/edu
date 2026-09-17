import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '나라장터 입찰공고 알림봇',
  description: '공공데이터포털 나라장터 입찰공고를 키워드로 감시하고 텔레그램으로 알립니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
