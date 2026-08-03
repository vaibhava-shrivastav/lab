import { getCurrentUser } from '@/lib/auth'

export async function requireAdmin() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return null
  return user
}
