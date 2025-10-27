import { redirect } from 'next/navigation'

export default function Home() {
  // Redirect first-time users directly to login
  redirect('/login')
}