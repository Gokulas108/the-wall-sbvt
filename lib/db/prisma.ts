import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import path from 'path';

function createPrismaClient() {
  const dbPath = path.join(process.cwd(), 'dev.db');
  const adapter = new PrismaLibSql({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter } as never);
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
