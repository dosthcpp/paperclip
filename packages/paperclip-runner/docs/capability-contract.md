<!-- GENERATED FILE — DO NOT EDIT. Run pnpm generate:capability-inventory. -->

# Capability Capability Contract

This generated contract is a self-contained derivative of the Paperclip skill, its seven references, the Paperclip Evals corpus, and the legacy MCP tool surface. It does not import or contact the Paperclip control plane.

The skill/reference inventory and eval cases are the only normative behavior sources. Paperclip does not use the legacy MCP calls as a production capability surface; all MCP names below are traceability aliases folded into normative eval rows. Their disposition, grants, assertions, and evidence contract are inherited from the target row rather than classified independently.

## Baseline Counts

- Skill/reference headings: 152
- Eval cases: 106 across 16 groups
- Total normative rows: 258
- Legacy MCP aliases folded into normative rows: 42

| Eval group | Cases |
| --- | ---: |
| hb | 5 |
| co | 6 |
| st | 8 |
| cm | 6 |
| se | 4 |
| su | 4 |
| bl | 5 |
| dp | 3 |
| ix | 9 |
| ap | 6 |
| ar | 4 |
| er | 9 |
| rf | 22 |
| mh | 4 |
| rs | 3 |
| wk | 8 |

## Regeneration

- `pnpm --dir packages/paperclip-runner generate:capability-inventory` imports the canonical baselines and rewrites every generated file.
- `pnpm --dir packages/paperclip-runner check:capability-inventory` validates counts, uniqueness, normative dispositions, one-to-one MCP folds, required fields, and generated-file drift without requiring the external eval repository.

## Skill / Reference Rows

| Capability | Primary disposition | Source anchor |
| --- | --- | --- |
| skill:skills/paperclip/SKILL.md:paperclip-skill | optional_agent_tool | skills/paperclip/SKILL.md#paperclip-skill |
| skill:skills/paperclip/SKILL.md:terminology | optional_agent_tool | skills/paperclip/SKILL.md#terminology |
| skill:skills/paperclip/SKILL.md:authentication | control_plane_owned | skills/paperclip/SKILL.md#authentication |
| skill:skills/paperclip/SKILL.md:the-heartbeat-procedure | optional_agent_tool | skills/paperclip/SKILL.md#the-heartbeat-procedure |
| skill:skills/paperclip/SKILL.md:generated-artifacts-and-work-products | always_agent_tool | skills/paperclip/SKILL.md#generated-artifacts-and-work-products |
| skill:skills/paperclip/SKILL.md:status-quick-guide | control_plane_owned | skills/paperclip/SKILL.md#status-quick-guide |
| skill:skills/paperclip/SKILL.md:monitors-and-watchers-say-only-what-you-actually-scheduled | optional_agent_tool | skills/paperclip/SKILL.md#monitors-and-watchers-say-only-what-you-actually-scheduled |
| skill:skills/paperclip/SKILL.md:delegating-review-tasks | always_agent_tool | skills/paperclip/SKILL.md#delegating-review-tasks |
| skill:skills/paperclip/SKILL.md:managing-a-user-s-inbox | control_plane_owned | skills/paperclip/SKILL.md#managing-a-user-s-inbox |
| skill:skills/paperclip/SKILL.md:issue-dependencies-blockers | control_plane_owned | skills/paperclip/SKILL.md#issue-dependencies-blockers |
| skill:skills/paperclip/SKILL.md:requesting-board-approval | optional_agent_tool | skills/paperclip/SKILL.md#requesting-board-approval |
| skill:skills/paperclip/SKILL.md:issue-thread-interactions | optional_agent_tool | skills/paperclip/SKILL.md#issue-thread-interactions |
| skill:skills/paperclip/SKILL.md:standalone-decisions | optional_agent_tool | skills/paperclip/SKILL.md#standalone-decisions |
| skill:skills/paperclip/SKILL.md:mcp-tool-approval-gates | optional_agent_tool | skills/paperclip/SKILL.md#mcp-tool-approval-gates |
| skill:skills/paperclip/SKILL.md:niche-workflow-pointers | optional_agent_tool | skills/paperclip/SKILL.md#niche-workflow-pointers |
| skill:skills/paperclip/SKILL.md:cases | optional_agent_tool | skills/paperclip/SKILL.md#cases |
| skill:skills/paperclip/SKILL.md:company-skills-workflow | optional_agent_tool | skills/paperclip/SKILL.md#company-skills-workflow |
| skill:skills/paperclip/SKILL.md:routines | optional_agent_tool | skills/paperclip/SKILL.md#routines |
| skill:skills/paperclip/SKILL.md:issue-workspace-runtime-controls | optional_agent_tool | skills/paperclip/SKILL.md#issue-workspace-runtime-controls |
| skill:skills/paperclip/SKILL.md:proposing-credentials-safely | optional_agent_tool | skills/paperclip/SKILL.md#proposing-credentials-safely |
| skill:skills/paperclip/SKILL.md:reading-granted-secrets | optional_agent_tool | skills/paperclip/SKILL.md#reading-granted-secrets |
| skill:skills/paperclip/SKILL.md:critical-rules | optional_agent_tool | skills/paperclip/SKILL.md#critical-rules |
| skill:skills/paperclip/SKILL.md:comment-style-required | always_agent_tool | skills/paperclip/SKILL.md#comment-style-required |
| skill:skills/paperclip/SKILL.md:update | optional_agent_tool | skills/paperclip/SKILL.md#update |
| skill:skills/paperclip/SKILL.md:planning-required-when-planning-requested | optional_agent_tool | skills/paperclip/SKILL.md#planning-required-when-planning-requested |
| skill:skills/paperclip/SKILL.md:key-endpoints-hot-routes | optional_agent_tool | skills/paperclip/SKILL.md#key-endpoints-hot-routes |
| skill:skills/paperclip/SKILL.md:searching-issues | optional_agent_tool | skills/paperclip/SKILL.md#searching-issues |
| skill:skills/paperclip/SKILL.md:full-reference | optional_agent_tool | skills/paperclip/SKILL.md#full-reference |
| skill:skills/paperclip/references/artifacts.md:generated-artifacts-and-work-products | always_agent_tool | skills/paperclip/references/artifacts.md#generated-artifacts-and-work-products |
| skill:skills/paperclip/references/artifacts.md:workspace-only-file-references | optional_agent_tool | skills/paperclip/references/artifacts.md#workspace-only-file-references |
| skill:skills/paperclip/references/cases.md:cases | optional_agent_tool | skills/paperclip/references/cases.md#cases |
| skill:skills/paperclip/references/cases.md:core-model | optional_agent_tool | skills/paperclip/references/cases.md#core-model |
| skill:skills/paperclip/references/cases.md:upsert-semantics | optional_agent_tool | skills/paperclip/references/cases.md#upsert-semantics |
| skill:skills/paperclip/references/cases.md:read-and-search | optional_agent_tool | skills/paperclip/references/cases.md#read-and-search |
| skill:skills/paperclip/references/cases.md:documents | always_agent_tool | skills/paperclip/references/cases.md#documents |
| skill:skills/paperclip/references/cases.md:fields | optional_agent_tool | skills/paperclip/references/cases.md#fields |
| skill:skills/paperclip/references/cases.md:issue-links | optional_agent_tool | skills/paperclip/references/cases.md#issue-links |
| skill:skills/paperclip/references/cases.md:child-cases | optional_agent_tool | skills/paperclip/references/cases.md#child-cases |
| skill:skills/paperclip/references/cases.md:attachments | optional_agent_tool | skills/paperclip/references/cases.md#attachments |
| skill:skills/paperclip/references/cases.md:lifecycle | optional_agent_tool | skills/paperclip/references/cases.md#lifecycle |
| skill:skills/paperclip/references/cases.md:worked-blog-post-example | optional_agent_tool | skills/paperclip/references/cases.md#worked-blog-post-example |
| skill:skills/paperclip/references/company-skills.md:company-skills-workflow | optional_agent_tool | skills/paperclip/references/company-skills.md#company-skills-workflow |
| skill:skills/paperclip/references/company-skills.md:what-exists | optional_agent_tool | skills/paperclip/references/company-skills.md#what-exists |
| skill:skills/paperclip/references/company-skills.md:permission-model | optional_agent_tool | skills/paperclip/references/company-skills.md#permission-model |
| skill:skills/paperclip/references/company-skills.md:core-endpoints | optional_agent_tool | skills/paperclip/references/company-skills.md#core-endpoints |
| skill:skills/paperclip/references/company-skills.md:install-a-skill-into-the-company | optional_agent_tool | skills/paperclip/references/company-skills.md#install-a-skill-into-the-company |
| skill:skills/paperclip/references/company-skills.md:app-shipped-catalog | optional_agent_tool | skills/paperclip/references/company-skills.md#app-shipped-catalog |
| skill:skills/paperclip/references/company-skills.md:external-source-import | optional_agent_tool | skills/paperclip/references/company-skills.md#external-source-import |
| skill:skills/paperclip/references/company-skills.md:source-types-in-order-of-preference | optional_agent_tool | skills/paperclip/references/company-skills.md#source-types-in-order-of-preference |
| skill:skills/paperclip/references/company-skills.md:example-skills-sh-import-preferred | optional_agent_tool | skills/paperclip/references/company-skills.md#example-skills-sh-import-preferred |
| skill:skills/paperclip/references/company-skills.md:example-github-import | optional_agent_tool | skills/paperclip/references/company-skills.md#example-github-import |
| skill:skills/paperclip/references/company-skills.md:inspect-what-was-installed | optional_agent_tool | skills/paperclip/references/company-skills.md#inspect-what-was-installed |
| skill:skills/paperclip/references/company-skills.md:assign-skills-to-an-existing-agent | optional_agent_tool | skills/paperclip/references/company-skills.md#assign-skills-to-an-existing-agent |
| skill:skills/paperclip/references/company-skills.md:include-skills-during-hire-or-create | optional_agent_tool | skills/paperclip/references/company-skills.md#include-skills-during-hire-or-create |
| skill:skills/paperclip/references/company-skills.md:notes | optional_agent_tool | skills/paperclip/references/company-skills.md#notes |
| skill:skills/paperclip/references/issue-workspaces.md:issue-workspace-runtime-controls | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#issue-workspace-runtime-controls |
| skill:skills/paperclip/references/issue-workspaces.md:discover-the-workspace | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#discover-the-workspace |
| skill:skills/paperclip/references/issue-workspaces.md:control-services | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#control-services |
| skill:skills/paperclip/references/issue-workspaces.md:start-all-configured-services-waits-for-configured-readiness-checks | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#start-all-configured-services-waits-for-configured-readiness-checks |
| skill:skills/paperclip/references/issue-workspaces.md:restart-all-configured-services | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#restart-all-configured-services |
| skill:skills/paperclip/references/issue-workspaces.md:stop-all-running-services | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#stop-all-running-services |
| skill:skills/paperclip/references/issue-workspaces.md:read-the-url | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#read-the-url |
| skill:skills/paperclip/references/issue-workspaces.md:mcp-tools | optional_agent_tool | skills/paperclip/references/issue-workspaces.md#mcp-tools |
| skill:skills/paperclip/references/routines.md:paperclip-routines | optional_agent_tool | skills/paperclip/references/routines.md#paperclip-routines |
| skill:skills/paperclip/references/routines.md:lifecycle | optional_agent_tool | skills/paperclip/references/routines.md#lifecycle |
| skill:skills/paperclip/references/routines.md:creating-a-routine | optional_agent_tool | skills/paperclip/references/routines.md#creating-a-routine |
| skill:skills/paperclip/references/routines.md:concurrency-policies | optional_agent_tool | skills/paperclip/references/routines.md#concurrency-policies |
| skill:skills/paperclip/references/routines.md:catch-up-policies | optional_agent_tool | skills/paperclip/references/routines.md#catch-up-policies |
| skill:skills/paperclip/references/routines.md:activity-gated-scheduled-runs | optional_agent_tool | skills/paperclip/references/routines.md#activity-gated-scheduled-runs |
| skill:skills/paperclip/references/routines.md:example-skip-quiet-nights | optional_agent_tool | skills/paperclip/references/routines.md#example-skip-quiet-nights |
| skill:skills/paperclip/references/routines.md:adding-triggers | optional_agent_tool | skills/paperclip/references/routines.md#adding-triggers |
| skill:skills/paperclip/references/routines.md:schedule-cron | optional_agent_tool | skills/paperclip/references/routines.md#schedule-cron |
| skill:skills/paperclip/references/routines.md:webhook | optional_agent_tool | skills/paperclip/references/routines.md#webhook |
| skill:skills/paperclip/references/routines.md:api-manual-only | optional_agent_tool | skills/paperclip/references/routines.md#api-manual-only |
| skill:skills/paperclip/references/routines.md:updating-and-deleting-triggers | optional_agent_tool | skills/paperclip/references/routines.md#updating-and-deleting-triggers |
| skill:skills/paperclip/references/routines.md:manual-run | optional_agent_tool | skills/paperclip/references/routines.md#manual-run |
| skill:skills/paperclip/references/routines.md:updating-a-routine | optional_agent_tool | skills/paperclip/references/routines.md#updating-a-routine |
| skill:skills/paperclip/references/routines.md:reading-routines-and-runs | optional_agent_tool | skills/paperclip/references/routines.md#reading-routines-and-runs |
| skill:skills/paperclip/references/workflows.md:paperclip-workflow-playbooks | optional_agent_tool | skills/paperclip/references/workflows.md#paperclip-workflow-playbooks |
| skill:skills/paperclip/references/workflows.md:project-setup-ceo-manager | optional_agent_tool | skills/paperclip/references/workflows.md#project-setup-ceo-manager |
| skill:skills/paperclip/references/workflows.md:openclaw-invite-ceo | optional_agent_tool | skills/paperclip/references/workflows.md#openclaw-invite-ceo |
| skill:skills/paperclip/references/workflows.md:setting-agent-instructions-path | optional_agent_tool | skills/paperclip/references/workflows.md#setting-agent-instructions-path |
| skill:skills/paperclip/references/workflows.md:company-import-export | optional_agent_tool | skills/paperclip/references/workflows.md#company-import-export |
| skill:skills/paperclip/references/workflows.md:self-test-playbook-app-level | optional_agent_tool | skills/paperclip/references/workflows.md#self-test-playbook-app-level |
| skill:skills/paperclip/references/api-reference.md:paperclip-api-reference | optional_agent_tool | skills/paperclip/references/api-reference.md#paperclip-api-reference |
| skill:skills/paperclip/references/api-reference.md:response-schemas | optional_agent_tool | skills/paperclip/references/api-reference.md#response-schemas |
| skill:skills/paperclip/references/api-reference.md:agent-record-get-api-agents-me-or-get-api-agents-agentid | optional_agent_tool | skills/paperclip/references/api-reference.md#agent-record-get-api-agents-me-or-get-api-agents-agentid |
| skill:skills/paperclip/references/api-reference.md:company-portability | optional_agent_tool | skills/paperclip/references/api-reference.md#company-portability |
| skill:skills/paperclip/references/api-reference.md:issue-with-ancestors-get-api-issues-issueid | optional_agent_tool | skills/paperclip/references/api-reference.md#issue-with-ancestors-get-api-issues-issueid |
| skill:skills/paperclip/references/api-reference.md:issue-update-response-patch-api-issues-issueid | optional_agent_tool | skills/paperclip/references/api-reference.md#issue-update-response-patch-api-issues-issueid |
| skill:skills/paperclip/references/api-reference.md:blocker-diagnostics-get-api-issues-issueid-diagnostics-blockers | control_plane_owned | skills/paperclip/references/api-reference.md#blocker-diagnostics-get-api-issues-issueid-diagnostics-blockers |
| skill:skills/paperclip/references/api-reference.md:wake-diagnostics-get-api-issues-issueid-diagnostics-wakes | control_plane_owned | skills/paperclip/references/api-reference.md#wake-diagnostics-get-api-issues-issueid-diagnostics-wakes |
| skill:skills/paperclip/references/api-reference.md:subtree-diagnostics-get-api-issues-issueid-diagnostics-subtree | optional_agent_tool | skills/paperclip/references/api-reference.md#subtree-diagnostics-get-api-issues-issueid-diagnostics-subtree |
| skill:skills/paperclip/references/api-reference.md:execution-policy-fields-on-an-issue | optional_agent_tool | skills/paperclip/references/api-reference.md#execution-policy-fields-on-an-issue |
| skill:skills/paperclip/references/api-reference.md:cross-agent-review-gates | always_agent_tool | skills/paperclip/references/api-reference.md#cross-agent-review-gates |
| skill:skills/paperclip/references/api-reference.md:worked-example-ic-heartbeat | optional_agent_tool | skills/paperclip/references/api-reference.md#worked-example-ic-heartbeat |
| skill:skills/paperclip/references/api-reference.md:1-identity-skip-if-already-in-context | control_plane_owned | skills/paperclip/references/api-reference.md#1-identity-skip-if-already-in-context |
| skill:skills/paperclip/references/api-reference.md:2-check-inbox | control_plane_owned | skills/paperclip/references/api-reference.md#2-check-inbox |
| skill:skills/paperclip/references/api-reference.md:3-already-have-issue-101-inprogress-highest-priority-continue-it | optional_agent_tool | skills/paperclip/references/api-reference.md#3-already-have-issue-101-inprogress-highest-priority-continue-it |
| skill:skills/paperclip/references/api-reference.md:4-do-the-actual-work-write-code-run-tests | optional_agent_tool | skills/paperclip/references/api-reference.md#4-do-the-actual-work-write-code-run-tests |
| skill:skills/paperclip/references/api-reference.md:5-work-is-done-update-status-and-comment-in-one-call | always_agent_tool | skills/paperclip/references/api-reference.md#5-work-is-done-update-status-and-comment-in-one-call |
| skill:skills/paperclip/references/api-reference.md:6-still-have-time-checkout-the-next-task | control_plane_owned | skills/paperclip/references/api-reference.md#6-still-have-time-checkout-the-next-task |
| skill:skills/paperclip/references/api-reference.md:7-made-partial-progress-not-done-yet-comment-and-exit | always_agent_tool | skills/paperclip/references/api-reference.md#7-made-partial-progress-not-done-yet-comment-and-exit |
| skill:skills/paperclip/references/api-reference.md:worked-example-report-a-board-user-s-mine-inbox | control_plane_owned | skills/paperclip/references/api-reference.md#worked-example-report-a-board-user-s-mine-inbox |
| skill:skills/paperclip/references/api-reference.md:board-user-created-the-requesting-issue | optional_agent_tool | skills/paperclip/references/api-reference.md#board-user-created-the-requesting-issue |
| skill:skills/paperclip/references/api-reference.md:fetch-the-board-user-s-mine-inbox-issues | control_plane_owned | skills/paperclip/references/api-reference.md#fetch-the-board-user-s-mine-inbox-issues |
| skill:skills/paperclip/references/api-reference.md:summarize-it-back-to-the-board-in-a-comment-or-document | always_agent_tool | skills/paperclip/references/api-reference.md#summarize-it-back-to-the-board-in-a-comment-or-document |
| skill:skills/paperclip/references/api-reference.md:worked-example-archive-a-resolved-inbox-item | control_plane_owned | skills/paperclip/references/api-reference.md#worked-example-archive-a-resolved-inbox-item |
| skill:skills/paperclip/references/api-reference.md:the-responsible-user-s-id-is-resolved-from-the-authenticated-agent-run | optional_agent_tool | skills/paperclip/references/api-reference.md#the-responsible-user-s-id-is-resolved-from-the-authenticated-agent-run |
| skill:skills/paperclip/references/api-reference.md:reverse-the-archive-if-it-was-premature-or-no-longer-desired | optional_agent_tool | skills/paperclip/references/api-reference.md#reverse-the-archive-if-it-was-premature-or-no-longer-desired |
| skill:skills/paperclip/references/api-reference.md:worked-example-reviewer-approver-heartbeat | always_agent_tool | skills/paperclip/references/api-reference.md#worked-example-reviewer-approver-heartbeat |
| skill:skills/paperclip/references/api-reference.md:worked-example-manager-heartbeat | optional_agent_tool | skills/paperclip/references/api-reference.md#worked-example-manager-heartbeat |
| skill:skills/paperclip/references/api-reference.md:1-identity-skip-if-already-in-context~2 | control_plane_owned | skills/paperclip/references/api-reference.md#1-identity-skip-if-already-in-context~2 |
| skill:skills/paperclip/references/api-reference.md:2-check-team-status | optional_agent_tool | skills/paperclip/references/api-reference.md#2-check-team-status |
| skill:skills/paperclip/references/api-reference.md:3-agent-42-is-blocked-read-comments | control_plane_owned | skills/paperclip/references/api-reference.md#3-agent-42-is-blocked-read-comments |
| skill:skills/paperclip/references/api-reference.md:4-unblock-reassign-and-comment | control_plane_owned | skills/paperclip/references/api-reference.md#4-unblock-reassign-and-comment |
| skill:skills/paperclip/references/api-reference.md:5-check-own-assignments | optional_agent_tool | skills/paperclip/references/api-reference.md#5-check-own-assignments |
| skill:skills/paperclip/references/api-reference.md:6-create-subtasks-and-delegate | optional_agent_tool | skills/paperclip/references/api-reference.md#6-create-subtasks-and-delegate |
| skill:skills/paperclip/references/api-reference.md:load-tests-depend-on-caching-layer-being-done-first-paperclip-will-auto-wake-agent-55-when-the-blocker-resolves | control_plane_owned | skills/paperclip/references/api-reference.md#load-tests-depend-on-caching-layer-being-done-first-paperclip-will-auto-wake-agent-55-when-the-blocker-resolves |
| skill:skills/paperclip/references/api-reference.md:7-dashboard-for-health-check | optional_agent_tool | skills/paperclip/references/api-reference.md#7-dashboard-for-health-check |
| skill:skills/paperclip/references/api-reference.md:comments-and-mentions | always_agent_tool | skills/paperclip/references/api-reference.md#comments-and-mentions |
| skill:skills/paperclip/references/api-reference.md:update | optional_agent_tool | skills/paperclip/references/api-reference.md#update |
| skill:skills/paperclip/references/api-reference.md:cross-team-work-and-delegation | optional_agent_tool | skills/paperclip/references/api-reference.md#cross-team-work-and-delegation |
| skill:skills/paperclip/references/api-reference.md:receiving-cross-team-work | optional_agent_tool | skills/paperclip/references/api-reference.md#receiving-cross-team-work |
| skill:skills/paperclip/references/api-reference.md:escalation | optional_agent_tool | skills/paperclip/references/api-reference.md#escalation |
| skill:skills/paperclip/references/api-reference.md:company-context | optional_agent_tool | skills/paperclip/references/api-reference.md#company-context |
| skill:skills/paperclip/references/api-reference.md:company-branding-ceo-board | optional_agent_tool | skills/paperclip/references/api-reference.md#company-branding-ceo-board |
| skill:skills/paperclip/references/api-reference.md:openclaw-invite-prompt-ceo | optional_agent_tool | skills/paperclip/references/api-reference.md#openclaw-invite-prompt-ceo |
| skill:skills/paperclip/references/api-reference.md:setting-agent-instructions-path | optional_agent_tool | skills/paperclip/references/api-reference.md#setting-agent-instructions-path |
| skill:skills/paperclip/references/api-reference.md:project-setup-create-workspace | optional_agent_tool | skills/paperclip/references/api-reference.md#project-setup-create-workspace |
| skill:skills/paperclip/references/api-reference.md:option-a-one-call-create-with-workspace | optional_agent_tool | skills/paperclip/references/api-reference.md#option-a-one-call-create-with-workspace |
| skill:skills/paperclip/references/api-reference.md:option-b-two-calls-project-first-then-workspace | optional_agent_tool | skills/paperclip/references/api-reference.md#option-b-two-calls-project-first-then-workspace |
| skill:skills/paperclip/references/api-reference.md:governance-and-approvals | optional_agent_tool | skills/paperclip/references/api-reference.md#governance-and-approvals |
| skill:skills/paperclip/references/api-reference.md:requesting-a-hire-management-only | optional_agent_tool | skills/paperclip/references/api-reference.md#requesting-a-hire-management-only |
| skill:skills/paperclip/references/api-reference.md:ceo-strategy-approval | optional_agent_tool | skills/paperclip/references/api-reference.md#ceo-strategy-approval |
| skill:skills/paperclip/references/api-reference.md:issue-thread-confirmations | always_agent_tool | skills/paperclip/references/api-reference.md#issue-thread-confirmations |
| skill:skills/paperclip/references/api-reference.md:checkbox-confirmations | always_agent_tool | skills/paperclip/references/api-reference.md#checkbox-confirmations |
| skill:skills/paperclip/references/api-reference.md:item-verdict-requests | optional_agent_tool | skills/paperclip/references/api-reference.md#item-verdict-requests |
| skill:skills/paperclip/references/api-reference.md:checking-approval-status | optional_agent_tool | skills/paperclip/references/api-reference.md#checking-approval-status |
| skill:skills/paperclip/references/api-reference.md:approval-follow-up-requesting-agent | always_agent_tool | skills/paperclip/references/api-reference.md#approval-follow-up-requesting-agent |
| skill:skills/paperclip/references/api-reference.md:issue-lifecycle | always_agent_tool | skills/paperclip/references/api-reference.md#issue-lifecycle |
| skill:skills/paperclip/references/api-reference.md:error-handling | control_plane_owned | skills/paperclip/references/api-reference.md#error-handling |
| skill:skills/paperclip/references/api-reference.md:full-api-reference | optional_agent_tool | skills/paperclip/references/api-reference.md#full-api-reference |
| skill:skills/paperclip/references/api-reference.md:agents | optional_agent_tool | skills/paperclip/references/api-reference.md#agents |
| skill:skills/paperclip/references/api-reference.md:issues-tasks | optional_agent_tool | skills/paperclip/references/api-reference.md#issues-tasks |
| skill:skills/paperclip/references/api-reference.md:companies-projects-goals | optional_agent_tool | skills/paperclip/references/api-reference.md#companies-projects-goals |
| skill:skills/paperclip/references/api-reference.md:routines | optional_agent_tool | skills/paperclip/references/api-reference.md#routines |
| skill:skills/paperclip/references/api-reference.md:approvals-costs-activity-dashboard | optional_agent_tool | skills/paperclip/references/api-reference.md#approvals-costs-activity-dashboard |
| skill:skills/paperclip/references/api-reference.md:secrets | optional_agent_tool | skills/paperclip/references/api-reference.md#secrets |
| skill:skills/paperclip/references/api-reference.md:agent-secret-proposals | optional_agent_tool | skills/paperclip/references/api-reference.md#agent-secret-proposals |
| skill:skills/paperclip/references/api-reference.md:agent-secret-access | optional_agent_tool | skills/paperclip/references/api-reference.md#agent-secret-access |
| skill:skills/paperclip/references/api-reference.md:common-mistakes | optional_agent_tool | skills/paperclip/references/api-reference.md#common-mistakes |

## Legacy MCP Alias Index

This is a compatibility/traceability index, not a tool catalog. “Inherited disposition” is shown only to make the normative target easy to audit.

| Legacy MCP name | Folded into normative row | Inherited disposition | Source anchor |
| --- | --- | --- | --- |
| paperclipMe | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts#paperclipMe |
| paperclipInboxLite | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts#paperclipInboxLite |
| paperclipListAgents | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListAgents |
| paperclipListSkills | eval:rf-cskill-audit-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListSkills |
| paperclipGetAgent | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetAgent |
| paperclipListIssues | eval:se-q-filters-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListIssues |
| paperclipGetIssue | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetIssue |
| paperclipGetHeartbeatContext | eval:hb-context-01 | control_plane_owned | packages/mcp-server/src/tools.ts#paperclipGetHeartbeatContext |
| paperclipListComments | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListComments |
| paperclipGetComment | eval:hb-wake-comment-01 | control_plane_owned | packages/mcp-server/src/tools.ts#paperclipGetComment |
| paperclipListIssueApprovals | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListIssueApprovals |
| paperclipListDocuments | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipListDocuments |
| paperclipGetDocument | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetDocument |
| paperclipListDocumentRevisions | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipListDocumentRevisions |
| paperclipListProjects | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListProjects |
| paperclipGetProject | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetProject |
| paperclipGetIssueWorkspaceRuntime | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetIssueWorkspaceRuntime |
| paperclipControlIssueWorkspaceServices | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipControlIssueWorkspaceServices |
| paperclipWaitForIssueWorkspaceService | eval:rf-iws-target-restart-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipWaitForIssueWorkspaceService |
| paperclipListGoals | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListGoals |
| paperclipGetGoal | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetGoal |
| paperclipListApprovals | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListApprovals |
| paperclipCreateApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipCreateApproval |
| paperclipGetApproval | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetApproval |
| paperclipGetApprovalIssues | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipGetApprovalIssues |
| paperclipListApprovalComments | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipListApprovalComments |
| paperclipCreateIssue | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipCreateIssue |
| paperclipUpdateIssue | eval:st-done-comment-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipUpdateIssue |
| paperclipCheckoutIssue | eval:co-body-contract-01 | control_plane_owned | packages/mcp-server/src/tools.ts#paperclipCheckoutIssue |
| paperclipReleaseIssue | eval:er-release-01 | control_plane_owned | packages/mcp-server/src/tools.ts#paperclipReleaseIssue |
| paperclipAddComment | eval:cm-multiline-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipAddComment |
| paperclipSuggestTasks | eval:ix-suggest-tasks-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipSuggestTasks |
| paperclipAskUserQuestions | eval:ix-questions-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipAskUserQuestions |
| paperclipRequestConfirmation | eval:ix-confirmation-plan-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipRequestConfirmation |
| paperclipRequestCheckboxConfirmation | eval:ix-checkbox-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipRequestCheckboxConfirmation |
| paperclipUpsertIssueDocument | eval:dp-plan-doc-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipUpsertIssueDocument |
| paperclipRestoreIssueDocumentRevision | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts#paperclipRestoreIssueDocumentRevision |
| paperclipLinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipLinkIssueApproval |
| paperclipUnlinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipUnlinkIssueApproval |
| paperclipApprovalDecision | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipApprovalDecision |
| paperclipAddApprovalComment | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipAddApprovalComment |
| paperclipApiRequest | eval:rf-api-404-report-01 | optional_agent_tool | packages/mcp-server/src/tools.ts#paperclipApiRequest |
