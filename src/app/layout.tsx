import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PDF Searcher',
  description: 'AI-powered PDF document processing and similarity search',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className="font-sans h-full bg-gray-50 dark:bg-gray-900 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
