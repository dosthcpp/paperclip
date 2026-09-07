import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ISSUE_COUNT_QUERY_PARAMS,
  ISSUE_LIST_QUERY_PARAMS,
  findUnsupportedIssueQueryParams,
  unsupportedIssueQueryParamsError,
} from "../http/issue-list-query-params.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ISSUES_ROUTE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../routes/issues.ts"),
  "utf8",
);

/**
 * Slice one route handler out of the route module by its opening literal and the
 * opening literal of the route that follows it. Both markers are asserted, so
 * reordering or renaming these routes fails here instead of silently scanning
 * the wrong region.
 */
function handlerSource(startMarker: string, endMarker: string) {
  const start = ISSUES_ROUTE_SOURCE.indexOf(startMarker);
  expect(start, `route marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = ISSUES_ROUTE_SOURCE.indexOf(endMarker, start + startMarker.length);
  expect(end, `route marker not found: ${endMarker}`).toBeGreaterThan(-1);
  return ISSUES_ROUTE_SOURCE.slice(start, end);
}

function queryParamsReadBy(source: string) {
  const names = new Set<string>();
  for (const match of source.matchAll(/req\.query\.([A-Za-z0-9_]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/req\.query\[["']([^"']+)["']\]/g)) names.add(match[1]);
  return [...names].sort();
}

describe("issue list query parameter contract", () => {
  // The defect this guards: a filter the handler reads but the allowlist omits is
  // rejected with 400 even though it works, and a filter the allowlist carries but
  // the handler never reads is accepted and silently ignored — the original bug.
  it("allowlists exactly the parameters the list handler reads", () => {
    const source = handlerSource(
      'router.get("/companies/:companyId/issues", async (req, res) => {',
      'router.get("/companies/:companyId/issues/count"',
    );

    expect(queryParamsReadBy(source)).toEqual([...ISSUE_LIST_QUERY_PARAMS].sort());
  });

  it("allowlists exactly the parameters the count handler reads", () => {
    const source = handlerSource(
      'router.get("/companies/:companyId/issues/count", async (req, res) => {',
      'router.get("/companies/:companyId/labels"',
    );

    expect(queryParamsReadBy(source)).toEqual([...ISSUE_COUNT_QUERY_PARAMS].sort());
  });

  it("keeps the count contract a subset of the list contract", () => {
    const listParams = new Set<string>(ISSUE_LIST_QUERY_PARAMS);
    expect(ISSUE_COUNT_QUERY_PARAMS.filter((name) => !listParams.has(name))).toEqual([]);
  });

  it("reports only the parameters outside the supported set", () => {
    expect(
      findUnsupportedIssueQueryParams(
        { status: "todo", assigneeId: "agent-1", limit: "100" },
        ISSUE_LIST_QUERY_PARAMS,
      ),
    ).toEqual(["assigneeId"]);
    expect(
      findUnsupportedIssueQueryParams({ status: "todo", assigneeAgentId: "a" }, ISSUE_LIST_QUERY_PARAMS),
    ).toEqual([]);
  });

  it("names both assignee filters for the ambiguous assigneeId", () => {
    const body = unsupportedIssueQueryParamsError(["assigneeId"], ISSUE_LIST_QUERY_PARAMS);

    expect(body.error).toBe(
      "Unsupported query parameter: assigneeId. Did you mean: assigneeId → assigneeAgentId or assigneeUserId?",
    );
    expect(body.unsupportedParameters).toEqual(["assigneeId"]);
    expect(body.supportedParameters).toEqual([...ISSUE_LIST_QUERY_PARAMS]);
  });

  it("suggests the correctly cased parameter for a casing mistake", () => {
    expect(unsupportedIssueQueryParamsError(["assigneeagentid"], ISSUE_LIST_QUERY_PARAMS).error).toContain(
      "assigneeagentid → assigneeAgentId",
    );
  });

  it("suggests nothing for a name with no plausible target", () => {
    const body = unsupportedIssueQueryParamsError(["totallyMadeUp"], ISSUE_LIST_QUERY_PARAMS);

    expect(body.error).toBe("Unsupported query parameter: totallyMadeUp.");
  });

  it("omits a suggestion the endpoint does not itself support", () => {
    // `view` is list-only, so a count-route caller must not be pointed at it.
    expect(unsupportedIssueQueryParamsError(["view"], ISSUE_COUNT_QUERY_PARAMS).error).toBe(
      "Unsupported query parameter: view.",
    );
  });

  it("lists every unsupported parameter in one error", () => {
    const body = unsupportedIssueQueryParamsError(["assigneeId", "search"], ISSUE_LIST_QUERY_PARAMS);

    expect(body.error).toBe(
      "Unsupported query parameters: assigneeId, search. " +
        "Did you mean: assigneeId → assigneeAgentId or assigneeUserId; search → q?",
    );
  });
});
