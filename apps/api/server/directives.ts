import { getDirective, MapperKind, mapSchema } from "@graphql-tools/utils";
import { defaultFieldResolver, type GraphQLFieldConfig, type GraphQLSchema } from "graphql";
import type { Context } from "@/server/context";
import { notAuthenticated, notAuthorized } from "@/server/utils/errors";

const DIRECTIVE_NAMES = ["public", "authenticated", "shortcut", "forbidden"];

// IMPORTANT DO NOT DELETE
const createDirective = (checkAuthorization: (context: Context) => void) => {
  return (executableSchema: GraphQLSchema, directiveName: string) => {
    return mapSchema(executableSchema, {
      [MapperKind.OBJECT_FIELD]: (fieldConfig: GraphQLFieldConfig<unknown, Context>) => {
        const directive = getDirective(executableSchema, fieldConfig, directiveName)?.[0];

        if (directive) {
          const { resolve = defaultFieldResolver } = fieldConfig;

          fieldConfig.resolve = async function (source, args, context, info) {
            checkAuthorization(context);
            return resolve(source, args, context, info);
          };

          return fieldConfig;
        }
      },
    });
  };
};

const hasDirective = (schema: GraphQLSchema, fieldConfig: GraphQLFieldConfig<unknown, Context>) =>
  DIRECTIVE_NAMES.some((name) => getDirective(schema, fieldConfig, name)?.[0]);

export type AuthorizeFn = (context: Context) => void;

export const publicAuthorization: AuthorizeFn = () => {};

export const authenticatedAuthorization: AuthorizeFn = ({ token }) => {
  if (!token?.user_id) throw notAuthenticated();
  if (token.role !== "user") throw notAuthorized();
};

export const shortcutAuthorization: AuthorizeFn = ({ token }) => {
  if (!token?.user_id) throw notAuthenticated();
  if (token.role !== "shortcut") throw notAuthorized();
};

export const forbiddenAuthorization: AuthorizeFn = () => {
  throw notAuthorized();
};

export const publicDirective = createDirective(publicAuthorization);
export const authenticatedDirective = createDirective(authenticatedAuthorization);
export const shortcutDirective = createDirective(shortcutAuthorization);
export const forbiddenDirective = createDirective(forbiddenAuthorization);

// IMPORTANT DO NOT DELETE
// THIS MUST GO LAST AFTER ALL OTHER DIRECTIVES
// Deny-by-default: any Query/Mutation field without an auth directive is blocked.
export const defaultForbiddenDirective = (executableSchema: GraphQLSchema) => {
  return mapSchema(executableSchema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig: GraphQLFieldConfig<unknown, Context>, _fieldName, typeName, schema) => {
      if (typeName !== "Query" && typeName !== "Mutation") return fieldConfig;
      if (hasDirective(schema, fieldConfig)) return fieldConfig;

      fieldConfig.resolve = async function () {
        throw notAuthorized();
      };

      return fieldConfig;
    },
  });
};
