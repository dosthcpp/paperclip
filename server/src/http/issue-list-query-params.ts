/**
 * Query-parameter contract for the company issue-list endpoints.
 *
 * `GET /api/companies/:companyId/issues` used to read the parameters it knew and
 * drop the rest. A caller that filtered on a plausible-but-wrong name — `assigneeId`
 * instead of `assigneeAgentId` — got a 200 carrying the *unfiltered* company list,
 * which is indistinguishable from a correctly filtered one. The caller cannot detect
 * the mistake from the response, so an agent asking for "my todo cards" is handed the
 * whole company's backlog and treats it as its own worklist.
 *
 * Unknown parameters are therefore rejected with 400, the same line the release body
 * schema draws for unknown body fields. The lists live here so the route handler and
 * the OpenAPI document read the same source; `openapi-routes.test.ts` asserts they agree.
 */

/** Parameters honoured by `GET /api/companies/:companyId/issues`. */
export const ISSUE_LIST_QUERY_PARAMS = [
  "attention",
  "assigneeAgentId",
  "assigneeUserId",
  "participantAgentId",
  "touchedByUserId",
  "inboxArchivedByUserId",
  "unreadForUserId",
  "status",
  "projectId",
  "workspaceId",
  "executionWorkspaceId",
  "parentId",
  "parentIssueId",
  "descendantOf",
  "labelId",
  "originKind",
  "originKindPrefix",
  "originId",
  "includeRoutineExecutions",
  "excludeRoutineExecutions",
  "includePluginOperations",
  "includeBlockedBy",
  "includeBlockedInboxAttention",
  "includeLiveDescendantSummary",
  "hasPlanDocument",
  "updatedSince",
  "q",
  "limit",
  "offset",
  "sortField",
  "sortDir",
  "view",
] as const;

/**
 * Parameters honoured by `GET /api/companies/:companyId/issues/count`.
 *
 * A subset of the list contract: the count route forces `attention=blocked`, has no
 * projection or ordering, and reads no per-user inbox filters. `limit` and `offset`
 * stay listed so the route's own "does not accept limit or offset" message keeps
 * answering for them instead of the generic unknown-parameter error.
 */
export const ISSUE_COUNT_QUERY_PARAMS = [
  "attention",
  "assigneeAgentId",
  "assigneeUserId",
  "participantAgentId",
  "status",
  "projectId",
  "workspaceId",
  "executionWorkspaceId",
  "parentId",
  "parentIssueId",
  "descendantOf",
  "labelId",
  "originKind",
  "originKindPrefix",
  "originId",
  "includeRoutineExecutions",
  "excludeRoutineExecutions",
  "includePluginOperations",
  "hasPlanDocument",
  "q",
  "limit",
  "offset",
] as const;

/**
 * Names that read like a supported filter but mean something else here. `assigneeId`
 * is the one that caused the silent-filter incident: it is ambiguous between the agent
 * and the user assignee, which is why it is rejected with both candidates named rather
 * than aliased to one of them.
 */
const ISSUE_LIST_QUERY_PARAM_ALIASES: Record<string, readonly string[]> = {
  agentId: ["assigneeAgentId", "participantAgentId"],
  assignee: ["assigneeAgentId", "assigneeUserId"],
  assigneeId: ["assigneeAgentId", "assigneeUserId"],
  label: ["labelId"],
  page: ["offset"],
  parent: ["parentId"],
  project: ["projectId"],
  query: ["q"],
  search: ["q"],
  size: ["limit"],
  state: ["status"],
  userId: ["assigneeUserId"],
  workspace: ["workspaceId"],
};

export function findUnsupportedIssueQueryParams(
  query: Record<string, unknown>,
  supported: readonly string[],
): string[] {
  const allowed = new Set<string>(supported);
  return Object.keys(query).filter((name) => !allowed.has(name));
}

function suggestionsFor(name: string, supported: readonly string[]): readonly string[] {
  const lowered = name.toLowerCase();
  const casingMatch = supported.filter((candidate) => candidate.toLowerCase() === lowered);
  if (casingMatch.length > 0) return casingMatch;
  const allowed = new Set<string>(supported);
  return (ISSUE_LIST_QUERY_PARAM_ALIASES[name] ?? ISSUE_LIST_QUERY_PARAM_ALIASES[lowered] ?? [])
    .filter((candidate) => allowed.has(candidate));
}

function joinWithOr(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

export function unsupportedIssueQueryParamsError(
  unsupported: readonly string[],
  supported: readonly string[],
) {
  const hints = unsupported
    .map((name) => {
      const suggestions = suggestionsFor(name, supported);
      return suggestions.length > 0 ? `${name} → ${joinWithOr(suggestions)}` : null;
    })
    .filter((hint): hint is string => hint !== null);
  const detail = hints.length > 0 ? ` Did you mean: ${hints.join("; ")}?` : "";
  return {
    error:
      `Unsupported query parameter${unsupported.length === 1 ? "" : "s"}: ` +
      `${unsupported.join(", ")}.${detail}`,
    unsupportedParameters: [...unsupported],
    supportedParameters: [...supported],
  };
}
