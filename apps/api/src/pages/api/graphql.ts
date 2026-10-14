import { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { makeExecutableSchema } from "@graphql-tools/schema";
import type { NextApiRequest, NextApiResponse } from "next";
import { type Context, getContext } from "@/server/context";
import {
  authenticatedDirective, defaultForbiddenDirective, forbiddenDirective, publicDirective, shortcutDirective,
} from "@/server/directives";
import { getRequestIp, isOverRateLimit } from "@/server/integrations/rateLimit";
import resolvers from "@/server/resolvers";
import typeDefs from "@/server/schemas.graphql";
import { formatError } from "@/server/utils/errors";

let schema = makeExecutableSchema({ typeDefs, resolvers });
schema = publicDirective(schema, "public");
schema = authenticatedDirective(schema, "authenticated");
schema = shortcutDirective(schema, "shortcut");
schema = forbiddenDirective(schema, "forbidden");
schema = defaultForbiddenDirective(schema);

const apolloServer = new ApolloServer<Context>({ schema, formatError });

const apolloHandler = startServerAndCreateNextHandler(apolloServer, {
  context: async (req: NextApiRequest, res: NextApiResponse) => await getContext(req, res),
});

const handler = async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (await isOverRateLimit("graphql_ip", getRequestIp(req))) {
    res.status(429).json({ errors: [{ message: "Too many requests.", extensions: { code: "RATE_LIMITED" } }] });
    return;
  }
  await apolloHandler(req, res);
};

export default handler;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "32kb",
    },
  },
};
