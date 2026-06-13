import { prisma } from './prisma.js'

/**
 * Ensures at least one admin user exists.
 * - If ADMIN_EMAIL env is set, that user is promoted to admin.
 * - Otherwise, if no admin exists, the oldest user (by createdAt) is promoted.
 * - No-ops gracefully when there are zero users.
 */
export async function bootstrapAdmin(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL

  if (adminEmail) {
    const user = await prisma.user.findUnique({ where: { email: adminEmail } })
    if (user) {
      if (!user.isAdmin) {
        await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } })
        console.log(`[bootstrap] Promoted ${adminEmail} to admin (ADMIN_EMAIL env)`)
      } else {
        console.log(`[bootstrap] ${adminEmail} is already admin (ADMIN_EMAIL env)`)
      }
    } else {
      console.warn(`[bootstrap] ADMIN_EMAIL set to ${adminEmail} but no such user found`)
    }
    return
  }

  // Check if any admin already exists
  const existingAdmin = await prisma.user.findFirst({ where: { isAdmin: true } })
  if (existingAdmin) {
    console.log(`[bootstrap] Admin already exists: ${existingAdmin.email}`)
    return
  }

  // Promote oldest user
  const oldest = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!oldest) {
    console.log('[bootstrap] No users yet — skipping admin promotion')
    return
  }

  await prisma.user.update({ where: { id: oldest.id }, data: { isAdmin: true } })
  console.log(`[bootstrap] Promoted oldest user ${oldest.email} to admin`)
}
