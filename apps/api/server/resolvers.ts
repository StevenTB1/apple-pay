import { GraphQLScalarType, valueFromASTUntyped } from "graphql";
import { SHORTCUT_MUTATIONS } from "@/server/services/shortcut";
import { TRANSACTION_MUTATIONS, TRANSACTION_QUERIES } from "@/server/services/transaction";

// Pass-through scalar: recordCapture accepts whatever the phone sends.
const JSONScalar = new GraphQLScalarType({
  name: "JSON",
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast, variables) => valueFromASTUntyped(ast, variables),
});

const resolvers = {
  JSON: JSONScalar,
  Query: {
    status: () => "api",
    ...TRANSACTION_QUERIES,
  },
  Mutation: {
    ...SHORTCUT_MUTATIONS,
    ...TRANSACTION_MUTATIONS,
  },
};

export default resolvers;
