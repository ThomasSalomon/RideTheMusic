import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/services/db";
import { comparePassword, hashPassword } from "@/utils/crypto";
import { AppError } from "@/utils/errors";

export async function authorizePasswordChange(
  actor: { userId: string },
  username: string,
  client: PrismaClient = prisma,
) {
  const user = await client.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!user) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  if (user.id !== actor.userId) {
    throw new AppError(
      "No autorizado para cambiar esta contraseña",
      403,
      "PASSWORD_CHANGE_FORBIDDEN",
    );
  }
  return { userId: user.id } as const;
}

export async function changePassword(
  context: Awaited<ReturnType<typeof authorizePasswordChange>>,
  input: { currentPassword: string; newPassword: string },
  client: PrismaClient = prisma,
): Promise<{ email: string; username: string; changedAt: Date }> {
  const hashedPassword = await hashPassword(input.newPassword);
  const changed = await client.$transaction(async (tx) => {
    const currentUser = await tx.user.findUnique({
      where: { id: context.userId },
      select: { password: true, email: true, username: true },
    });
    if (
      !currentUser ||
      !(await comparePassword(input.currentPassword, currentUser.password))
    ) {
      return null;
    }

    const now = new Date();
    await tx.user.update({
      where: { id: context.userId },
      data: { password: hashedPassword, credentialsVersion: { increment: 1 } },
    });
    await tx.authSession.updateMany({
      where: { userId: context.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return { email: currentUser.email, username: currentUser.username, changedAt: now };
  });

  if (!changed) {
    throw new AppError(
      "La contraseña actual es incorrecta",
      400,
      "CURRENT_PASSWORD_INVALID",
    );
  }
  return changed;
}
