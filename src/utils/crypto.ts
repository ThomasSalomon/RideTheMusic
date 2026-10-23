import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const BCRYPT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// bcrypt rejects malformed hashes instantly, so the stand-in must be a real hash
// with the same cost for unknown accounts to take as long as wrong passwords.
let dummyHash: Promise<string> | undefined;

export async function comparePasswordWithoutAccount(password: string): Promise<false> {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString("hex"), BCRYPT_ROUNDS);
  await bcrypt.compare(password, await dummyHash);
  return false;
}
