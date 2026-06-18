import {
  GraphQLError,
  Kind,
  NoSchemaIntrospectionCustomRule,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule
} from "graphql";
import type { Plugin } from "graphql-yoga";

export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_MAX_FIELDS = 300;

function selectionSetDepth(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visited: Set<string>
): number {
  let max = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const childDepth = selection.selectionSet
        ? 1 + selectionSetDepth(selection.selectionSet, fragments, visited)
        : 1;
      max = Math.max(max, childDepth);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      if (selection.selectionSet) {
        max = Math.max(max, selectionSetDepth(selection.selectionSet, fragments, visited));
      }
    } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (fragment && !visited.has(name)) {
        visited.add(name);
        max = Math.max(max, selectionSetDepth(fragment.selectionSet, fragments, visited));
        visited.delete(name);
      }
    }
  }
  return max;
}

/** Reject operations whose nested selection depth exceeds `maxDepth`. */
export function createDepthLimitRule(maxDepth: number): ValidationRule {
  return (context: ValidationContext) => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition);
      }
    }

    return {
      OperationDefinition(node) {
        const depth = selectionSetDepth(node.selectionSet, fragments, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query depth ${depth} exceeds the maximum allowed depth of ${maxDepth}.`, { nodes: [node] })
          );
        }
      }
    };
  };
}

/** Simple complexity guard: reject operations selecting too many fields. */
export function createFieldCountRule(maxFields: number): ValidationRule {
  return (context: ValidationContext) => {
    let count = 0;
    return {
      Field() {
        count += 1;
        if (count === maxFields + 1) {
          context.reportError(
            new GraphQLError(`Query is too complex: more than ${maxFields} fields requested.`)
          );
        }
      }
    };
  };
}

export type ProspectSecurityOptions = {
  maxDepth?: number;
  maxFields?: number;
  disableIntrospection?: boolean;
};

/**
 * Yoga/envelop plugin that installs the prospect API's query-safety validation
 * rules: a depth limit, a field-count (complexity) limit, and — in production —
 * a ban on schema introspection.
 */
export function useProspectSecurity(options: ProspectSecurityOptions = {}): Plugin {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFields = options.maxFields ?? DEFAULT_MAX_FIELDS;
  const disableIntrospection = options.disableIntrospection ?? false;

  return {
    onValidate({ addValidationRule }) {
      addValidationRule(createDepthLimitRule(maxDepth));
      addValidationRule(createFieldCountRule(maxFields));
      if (disableIntrospection) {
        addValidationRule(NoSchemaIntrospectionCustomRule);
      }
    }
  };
}
