import { NextResponse } from "next/server";
import { prisma } from "@/services/db";
import { rememberRegistrationDevice } from "@/services/login-alerts";
import { setAuthCookie, signToken } from "@/utils/auth";
import { hashPassword } from "@/utils/crypto";
import { rateLimit, getClientIP } from "@/utils/rateLimit";
import { readJsonObject, rejectUnknownFields, RequestBodyError } from "@/utils/request-body";

// Starts with a letter or digit so names never read as relative paths in /users/[username].
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,29}$/;
const MAX_EMAIL_LENGTH = 254;

export async function POST(req: Request) {
  try {
    // Without a trusted proxy address, all registrations share one bucket
    // rather than letting forged X-Forwarded-For values mint new ones.
    const ip = getClientIP(req) ?? "unidentified";
    const { success } = rateLimit(`register:ip:${ip}`, { windowMs: 60 * 60 * 1000, max: 10 }); // 10 registrations per hour
    
    if (!success) {
      return NextResponse.json({ error: "Demasiados registros desde esta IP. Intenta más tarde." }, { status: 429 });
    }

    const body = await readJsonObject(req);
    rejectUnknownFields(body, ["username", "email", "password"]);
    const { username, email, password } = body;

    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string" || !username || !email || !password) {
      return NextResponse.json(
        { error: "Todos los campos son obligatorios" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (email.length > MAX_EMAIL_LENGTH || !emailRegex.test(email)) {
      return NextResponse.json(
        { error: "El correo electrónico no tiene un formato válido" },
        { status: 400 }
      );
    }

    if (username.length < 3) {
      return NextResponse.json(
        { error: "El usuario debe tener al menos 3 caracteres" },
        { status: 400 }
      );
    }

    if (!USERNAME_PATTERN.test(username)) {
      return NextResponse.json(
        { error: "El usuario debe tener hasta 30 caracteres, empezar con una letra o número y usar solo letras, números, puntos, guiones o guiones bajos" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email },
        ],
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "El nombre de usuario o email ya está en uso" },
        { status: 400 }
      );
    }

    // Hash password and create user
    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
      },
    });

    // Generate JWT token
    const token = await signToken({
      userId: user.id,
      username: user.username,
      credentialsVersion: user.credentialsVersion,
    });

    const response = NextResponse.json({
      message: "Registro exitoso",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
    });

    setAuthCookie(response, token);
    await rememberRegistrationDevice(req, response, user.id);

    return response;
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
