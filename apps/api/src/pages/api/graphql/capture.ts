import { GraphQLError } from "graphql";
import type { NextApiRequest, NextApiResponse } from "next";
import { getContext } from "@/server/context";
import { getRequestIp, isOverRateLimit } from "@/server/integrations/rateLimit";
import { shortcutAuthorization } from "@/server/directives";
import { SHORTCUT_MUTATIONS } from "@/server/services/shortcut";

const STATUS: Record<string, number> = { BAD_USER_INPUT: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, CONFLICT: 409 };

// The one non-GraphQL door: the iPhone Shortcut posts its transaction as-is (a file, text or JSON)
// and the whole body becomes recordCapture's input. Everything else goes through /api/graphql.
export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (await isOverRateLimit("capture_ip", getRequestIp(req))) {
    res.status(429).json({ error: "Too many requests." });
    return;
  }
  try {
    const context = await getContext(req, res);
    shortcutAuthorization(context);
    res.status(200).json(await SHORTCUT_MUTATIONS.recordCapture(null, { input: req.body }, context));
  } catch (error) {
    const status = error instanceof GraphQLError ? STATUS[String(error.extensions.code)] : undefined;
    if (!status) console.error("[capture]", error);
    res.status(status ?? 500).json({ error: status ? (error as Error).message : "The request could not be completed." });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "32kb",
    },
  },
};
