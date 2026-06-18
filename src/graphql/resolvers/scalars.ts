import { GraphQLScalarType, Kind } from "graphql";

// Minimal ISO-8601 DateTime scalar. Serializes Date (or date-like string) to an
// ISO string; parses incoming strings to Date.
export const DateTimeScalar = new GraphQLScalarType<Date | null, string>({
  name: "DateTime",
  description: "An ISO-8601 date-time string.",
  serialize(value) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "string") {
      return new Date(value).toISOString();
    }
    throw new TypeError("DateTime must be a Date or ISO string.");
  },
  parseValue(value) {
    if (typeof value !== "string") {
      throw new TypeError("DateTime must be provided as an ISO string.");
    }
    return new Date(value);
  },
  parseLiteral(ast) {
    return ast.kind === Kind.STRING ? new Date(ast.value) : null;
  }
});
