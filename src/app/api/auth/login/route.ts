import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import { setAuthCookie, signToken } from "@/utils/auth";
import { comparePassword, comparePasswordWithoutAccount } from "@/utils/crypto";
import { rateLimit, getClientIP } from "@/utils/rateLimit";
import { readJsonObject, rejectUnknownFields, RequestBodyError } from "@/utils/request-body";

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, max: 10 }; // 10 attempts per 15 minutes
const MAX_LOGIN_IDENTIFIER_LENGTH = 320;

function tooManyAttempts() {
  return NextResponse.json({ error: "Demasiados intentos de inicio de sesión. Por favor, intenta de nuevo más tarde." }, { status: 429 });
}

export async function POST(req: Request) {
  try {
    // The address limit only applies when a trusted proxy supplies it; the
    // per-account limit below holds even when every client can forge headers.
    const ip = getClientIP(req);
    if (ip && !rateLimit(`login:ip:${ip}`, LOGIN_RATE_LIMIT).success) {
      return tooManyAttempts();
    }

    const body = await readJsonObject(req);
    rejectUnknownFields(body, ["usernameOrEmail", "password"]);
    const { usernameOrEmail, password } = body;

    if (typeof usernameOrEmail !== "string" || typeof password !== "string" || !usernameOrEmail || !password) {
      return NextResponse.json(
        { error: "Todos los campos son obligatorios" },
        { status: 400 }
      );
    }

    if (usernameOrEmail.length > MAX_LOGIN_IDENTIFIER_LENGTH) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 400 }
      );
    }

    const accountKey = `login:account:${usernameOrEmail.trim().toLowerCase()}`;
    if (!rateLimit(accountKey, LOGIN_RATE_LIMIT).success) {
      return tooManyAttempts();
    }

    // Find user by username or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: usernameOrEmail },
          { email: usernameOrEmail },
        ],
      },
    });

    if (!user) {
      // Spend the same bcrypt work as a wrong password to avoid a timing oracle.
      await comparePasswordWithoutAccount(password);
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 400 }
      );
    }

    // Compare passwords
    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: "Credenciales inválidas" },
        { status: 400 }
      );
    }

    // Generate JWT token
    const token = await signToken({
      userId: user.id,
      username: user.username,
      credentialsVersion: user.credentialsVersion,
    });

    const response = NextResponse.json({
      message: "Inicio de sesión exitoso",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });

    setAuthCookie(response, token);

    return response;
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
