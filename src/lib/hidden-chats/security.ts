import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(pbkdf2);

export const PIN_HASH_ITERATIONS = 600_000;
export {
  filterVisibleConversations,
  isConversationMember,
  isGrantActive,
  isPinAttemptAllowed,
  isValidPin,
  MAX_PIN_ATTEMPTS,
} from "./rules";

export type PinCredential = {
  salt: string;
  pin_hash: string;
  iterations: number;
};

export { isValidSecretCode } from "./entry";

async function hashSecret(secret: string): Promise<PinCredential> {
  const salt = randomBytes(16);
  const derived = await deriveKey(secret, salt, PIN_HASH_ITERATIONS, 32, "sha256");

  return {
    salt: salt.toString("hex"),
    pin_hash: derived.toString("hex"),
    iterations: PIN_HASH_ITERATIONS,
  };
}

async function verifySecret(secret: string, credential: PinCredential): Promise<boolean> {
  if (
    !/^[a-f0-9]{32}$/.test(credential.salt) ||
    !/^[a-f0-9]{64}$/.test(credential.pin_hash) ||
    !Number.isInteger(credential.iterations) ||
    credential.iterations < PIN_HASH_ITERATIONS
  ) {
    return false;
  }

  const expected = Buffer.from(credential.pin_hash, "hex");
  const actual = await deriveKey(
    secret,
    Buffer.from(credential.salt, "hex"),
    credential.iterations,
    expected.length,
    "sha256",
  );
  return timingSafeEqual(actual, expected);
}

export function hashPin(pin: string): Promise<PinCredential> {
  return hashSecret(pin);
}

export function verifyPin(pin: string, credential: PinCredential): Promise<boolean> {
  return verifySecret(pin, credential);
}

export function hashSecretCode(code: string): Promise<PinCredential> {
  return hashSecret(code);
}

export function verifySecretCode(code: string, credential: PinCredential): Promise<boolean> {
  return verifySecret(code, credential);
}
