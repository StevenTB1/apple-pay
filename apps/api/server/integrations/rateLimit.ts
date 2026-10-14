// Rate limit client (Upstash Redis). Owns the connection, the windows, identifier hashing and
// fail-open behaviour, so an endpoint names a purpose instead of wiring Redis itself.

import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { NextApiRequest } from "next";

// Every window: [requests, seconds]. Closed so a typo cannot silently open a fresh key space.
const WINDOWS = {
  graphql_ip: [120, 60],
  capture_ip: [30, 60],
} as const;

export type RateLimitPurpose = keyof typeof WINDOWS;

const TIMEOUT_MS = 750;

// Incomplete credentials disable limiting instead of throwing, and say so: a secret gap must not stop traffic.
const loadConfig = () => {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    console.warn("[rateLimit] disabled: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set");
    return null;
  }
  return { url, token };
};

const CONFIG = loadConfig();

let redis: Redis | undefined;
const limiters = new Map<RateLimitPurpose, Ratelimit>();

// Built on first use and cached per window, so importing this never opens a connection.
const getRateLimiter = (purpose: RateLimitPurpose) => {
  if (!CONFIG) return undefined;
  const cached = limiters.get(purpose);
  if (cached) return cached;

  redis ??= new Redis({ url: CONFIG.url, token: CONFIG.token });
  const [limit, window_seconds] = WINDOWS[purpose];
  const limiter = new Ratelimit({
    redis,
    analytics: false,
    timeout: TIMEOUT_MS,
    prefix: `apple-pay:${purpose}`,
    limiter: Ratelimit.slidingWindow(limit, `${window_seconds} s`),
  });

  limiters.set(purpose, limiter);
  return limiter;
};

// Vercel puts the caller's address first in x-forwarded-for.
export const getRequestIp = (req: NextApiRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
};

// Fail open everywhere: a limiter that errors, times out or is unconfigured must never block.
export const isOverRateLimit = async (purpose: RateLimitPurpose, identifier: string): Promise<boolean> => {
  const limiter = getRateLimiter(purpose);
  if (!limiter) return false;

  try {
    // Hashed so raw addresses never reach Redis.
    const response = await limiter.limit(createHash("sha256").update(`${purpose}\0${identifier}`).digest("hex"));
    if (response.reason === "timeout") {
      console.info(`[rateLimit] ${purpose} timed out, allowing the request`);
      return false;
    }
    return !response.success;
  } catch (error) {
    console.info(`[rateLimit] ${purpose} failed: ${(error as Error).message}`);
    return false;
  }
};
