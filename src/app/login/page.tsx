'use client'

import { GoogleAuthButton } from '@/components/auth/oauth-buttons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Image from 'next/image'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
            <Image
              src="/Mark Logo - Color.png"
              alt="PDF Searcher logo"
              width={1080}
              height={1080}
              className="h-16 w-16 object-contain"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">PDF Searcher</h1>
        </div>

        <Card className="shadow-xl border-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-6">
            <CardTitle className="text-xl text-center text-gray-900 dark:text-white">Welcome to PDF Searcher</CardTitle>
            <CardDescription className="text-center text-gray-600 dark:text-gray-400">
              Sign in with your Google account to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleAuthButton />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
