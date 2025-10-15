import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll: async () => request.cookies.getAll().map(cookie => ({
          name: cookie.name,
          value: cookie.value
        })),
        setAll: async (cookiesToSet) => {
          for (const cookie of cookiesToSet) {
            request.cookies.set({
              name: cookie.name,
              value: cookie.value,
              ...cookie.options
            })
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            })
            response.cookies.set({
              name: cookie.name,
              value: cookie.value,
              ...cookie.options,
            })
          }
        },
      },
    }
  )

  // Skip auth check for auth callback to prevent redirect loops
  if (request.nextUrl.pathname.startsWith('/auth/callback')) {
    return response
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protect authenticated routes
  if (!user && (
    request.nextUrl.pathname.startsWith('/dashboard') ||
    request.nextUrl.pathname.startsWith('/documents') ||
    request.nextUrl.pathname.startsWith('/api/documents') ||
    request.nextUrl.pathname.startsWith('/api/upload')
  )) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Redirect authenticated users away from auth pages
  if (user && (
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/signup')
  )) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}
