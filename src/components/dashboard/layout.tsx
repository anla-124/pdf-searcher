'use client'

import { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { MobileNav } from './mobile-nav'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import Image from 'next/image'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gradient-to-br dark:from-slate-950 dark:to-slate-900">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <ErrorBoundary>
          <Sidebar />
        </ErrorBoundary>
      </div>
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700/50 bg-white dark:bg-slate-950/95 backdrop-blur-xl">
          <ErrorBoundary>
            <MobileNav />
          </ErrorBoundary>
          <div className="flex items-center space-x-2">
            <div className="flex h-8 w-8 items-center justify-center">
              <Image 
                src="/mark-logo-color.png" 
                alt="Company Logo" 
                width={32} 
                height={32}
                className="h-8 w-8 object-contain"
              />
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
              PDF AI
            </span>
          </div>
        </div>

        <main className="flex-1 overflow-x-hidden overflow-y-auto">
          <div className="container mx-auto px-4 md:px-6 py-6 md:py-8">
            <ErrorBoundary>
              {children}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
