import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

const SESSION_COOKIE = "kc-donor-form-session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

type SafeUser = {
  id: number;
  username: string;
  role: "admin" | "volunteer";
  isActive: boolean;
  amountInCash: number;
  amountPledge: number;
  amountTotal: number;
};

function hashPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export async function ensureDefaultAdminUser(): Promise<void> {
  const hasUsers = await prisma.donorFormUser.count();
  if (hasUsers > 0) return;

  const adminUsername = normalizeUsername(
    process.env.DONOR_FORM_DEFAULT_ADMIN_USERNAME || "admin",
  );
  const adminPin = process.env.DONOR_FORM_DEFAULT_ADMIN_PIN || "1234";
  const safePin = isValidPin(adminPin) ? adminPin : "1234";

  await prisma.donorFormUser.create({
    data: {
      username: adminUsername,
      password: hashPin(safePin),
      role: "admin",
    },
  });
}

export async function authenticateUser(username: string, pin: string) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !isValidPin(pin)) return null;

  const user = await prisma.donorFormUser.findUnique({
    where: { username: normalizedUsername },
    select: {
      id: true,
      username: true,
      password: true,
      role: true,
      isActive: true,
      amountInCash: true,
      amountPledge: true,
      amountTotal: true,
    },
  });

  if (!user || !user.isActive) return null;
  if (user.password !== hashPin(pin)) return null;

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    amountInCash: user.amountInCash,
    amountPledge: user.amountPledge,
    amountTotal: user.amountTotal,
  } as SafeUser;
}

export async function createSession(response: NextResponse, userId: number) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.donorFormSession.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  });

  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySessionByToken(token: string) {
  if (!token) return;
  await prisma.donorFormSession.deleteMany({ where: { token } });
}

export async function clearAuthCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    path: "/",
    expires: new Date(0),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

export async function getSessionTokenFromRequest(req: NextRequest) {
  return req.cookies.get(SESSION_COOKIE)?.value || "";
}

export async function getSessionTokenFromServerCookies() {
  return (await cookies()).get(SESSION_COOKIE)?.value || "";
}

export async function getUserFromSessionToken(token: string) {
  if (!token) return null;

  const session = await prisma.donorFormSession.findUnique({
    where: { token },
    select: {
      id: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
          role: true,
          isActive: true,
          amountInCash: true,
          amountPledge: true,
          amountTotal: true,
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now() || !session.user.isActive) {
    await prisma.donorFormSession.delete({ where: { id: session.id } });
    return null;
  }

  return session.user;
}

export async function getCurrentUserFromRequest(req: NextRequest) {
  const token = await getSessionTokenFromRequest(req);
  return getUserFromSessionToken(token);
}

export async function getCurrentUserFromServerCookies() {
  const token = await getSessionTokenFromServerCookies();
  return getUserFromSessionToken(token);
}

export async function requireAdminFromRequest(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user || user.role !== "admin") return null;
  return user;
}

export function toSafeUser(user: {
  id: number;
  username: string;
  role: "admin" | "volunteer";
  isActive: boolean;
  amountInCash: number;
  amountPledge: number;
  amountTotal: number;
}) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    amountInCash: user.amountInCash,
    amountPledge: user.amountPledge,
    amountTotal: user.amountTotal,
  };
}

export function hashPasswordPin(pin: string): string {
  return hashPin(pin);
}
