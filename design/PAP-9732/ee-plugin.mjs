// src/ui/app.tsx
import { useEffect, useMemo, useState } from "react";
import {
  AssigneePicker,
  DataTable,
  ErrorBoundary,
  JsonTree,
  KeyValueList,
  MetricCard,
  ProjectPicker,
  Spinner,
  StatusBadge,
  useHostContext,
  usePluginAction,
  usePluginData
} from "@paperclipai/plugin-sdk/ui";
import { jsx, jsxs } from "react/jsx-runtime";
var HUMAN_ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer"
};
var MEMBER_PERMISSION_KEYS = [
  "agents:create",
  "users:invite",
  "users:manage_permissions",
  "tasks:assign",
  "tasks:manage_active_checkouts",
  "joins:approve",
  "environments:manage"
];
var PERMISSION_LABELS = {
  "agents:create": "Create agents",
  "users:invite": "Invite humans and agents",
  "users:manage_permissions": "Manage members and grants",
  "tasks:assign": "Assign tasks",
  "tasks:assign_scope": "Assign scoped tasks",
  "tasks:manage_active_checkouts": "Manage active task checkouts",
  "joins:approve": "Approve join requests",
  "environments:manage": "Manage environments"
};
var IMPLICIT_ROLE_GRANTS = {
  owner: ["agents:create", "users:invite", "users:manage_permissions", "tasks:assign", "joins:approve"],
  admin: ["agents:create", "users:invite", "tasks:assign", "joins:approve"],
  operator: ["tasks:assign"],
  viewer: []
};
var layoutStack = {
  display: "grid",
  gap: "16px",
  padding: "24px 0"
};
var cardStyle = {
  border: "1px solid var(--border, #e2e8f0)",
  borderRadius: "8px",
  padding: "16px",
  display: "grid",
  gap: "12px",
  background: "var(--card, #ffffff)"
};
var subtleCardStyle = {
  border: "1px solid var(--border, #e2e8f0)",
  borderRadius: "8px",
  padding: "12px",
  display: "grid",
  gap: "8px",
  background: "var(--background, transparent)"
};
var mutedTextStyle = {
  color: "var(--muted-foreground, #64748b)",
  fontSize: "0.9rem",
  lineHeight: 1.5
};
var sectionHeadingStyle = {
  fontSize: "0.75rem",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--muted-foreground, #64748b)"
};
var rowStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "8px"
};
var gridStyle = {
  display: "grid",
  gap: "12px",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))"
};
var inputStyle = {
  width: "100%",
  border: "1px solid var(--border, #cbd5e1)",
  borderRadius: "6px",
  padding: "8px 10px",
  background: "var(--background, transparent)",
  color: "inherit",
  fontSize: "0.85rem"
};
var buttonStyle = {
  padding: "7px 12px",
  borderRadius: "6px",
  border: "1px solid var(--border, #cbd5e1)",
  background: "var(--background, transparent)",
  color: "inherit",
  cursor: "pointer"
};
var primaryButtonStyle = {
  ...buttonStyle,
  background: "var(--foreground, #0f172a)",
  color: "var(--background, #ffffff)"
};
var warningStyle = {
  border: "1px solid var(--warning-border, #facc15)",
  background: "var(--warning-muted, #fefce8)",
  borderRadius: "8px",
  padding: "10px 12px",
  color: "var(--warning-foreground, #713f12)"
};
var fieldStyle = {
  display: "grid",
  gap: "6px"
};
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function statusForDecision(allowed) {
  return allowed ? "ok" : "error";
}
function decisionLabel(allowed) {
  return allowed ? "\u2713 Allowed" : "\u2715 Denied";
}
function membershipStatusVariant(status) {
  if (status === "active") return "ok";
  if (status === "pending") return "pending";
  if (status === "suspended" || status === "archived") return "warning";
  return "info";
}
function formatPermission(permissionKey) {
  return PERMISSION_LABELS[permissionKey] ?? permissionKey;
}
function formatScope(scope) {
  if (!scope || Object.keys(scope).length === 0) return "Any scope";
  const parts = Object.entries(scope).map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(", ");
}
function formatMode(value) {
  if (!value) return "Not set";
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
function getPolicySection(policy, key) {
  const value = policy?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function getPolicyString(policy, section, key, fallback) {
  const value = getPolicySection(policy, section)[key];
  return typeof value === "string" ? value : fallback;
}
function getPolicyBoolean(policy, section, key, fallback) {
  const value = getPolicySection(policy, section)[key];
  return typeof value === "boolean" ? value : fallback;
}
function RawDisclosure({ label = "Raw response", data }) {
  return /* @__PURE__ */ jsxs("details", { children: [
    /* @__PURE__ */ jsx("summary", { style: { ...mutedTextStyle, cursor: "pointer" }, children: label }),
    /* @__PURE__ */ jsx(JsonTree, { data, defaultExpandDepth: 1 })
  ] });
}
function CapabilityWarning({ warnings }) {
  if (warnings.length === 0) return null;
  const denied = warnings.some((warning) => warning.code === "CAPABILITY_DENIED");
  return /* @__PURE__ */ jsxs("div", { style: warningStyle, children: [
    /* @__PURE__ */ jsx("strong", { children: denied ? "Some advanced data is unavailable." : "Some advanced data could not be loaded." }),
    /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: denied ? "The plugin is missing one or more capability grants. Install the latest version or re-activate the plugin to restore the missing surfaces." : "Existing restrictions remain enforced by core. Retry once the underlying service is reachable." }),
    /* @__PURE__ */ jsx("ul", { style: { margin: "6px 0 0", paddingLeft: "18px" }, children: warnings.map((warning, index) => /* @__PURE__ */ jsxs("li", { children: [
      /* @__PURE__ */ jsx("code", { children: warning.code }),
      ": ",
      warning.message
    ] }, `${warning.code}-${index}`)) })
  ] });
}
function LoadingState({ label }) {
  return /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
    /* @__PURE__ */ jsx(Spinner, { size: "sm", label }),
    /* @__PURE__ */ jsx("span", { style: mutedTextStyle, children: label })
  ] });
}
function MissingCompanyState() {
  return /* @__PURE__ */ jsx("div", { style: layoutStack, children: /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
    /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Permissions" }),
    /* @__PURE__ */ jsx("strong", { children: "No active company" }),
    /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Switch into a company to manage advanced permissions." })
  ] }) });
}
function UnlicensedState({
  companyId,
  onActivate,
  activating
}) {
  return /* @__PURE__ */ jsx("div", { style: layoutStack, children: /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
    /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Paperclip EE Permissions" }),
    /* @__PURE__ */ jsx("strong", { children: "Advanced permissions mode is not active" }),
    /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Members can collaborate across this company by default. Activate Paperclip EE permissions to unlock scoped grants, protected-agent controls, assignment previews, and audit filters." }),
    /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("button", { type: "button", style: buttonStyle, disabled: activating, onClick: onActivate, children: activating ? /* @__PURE__ */ jsx(LoadingState, { label: "Activating" }) : "Activate for this company" }) }),
    /* @__PURE__ */ jsx(KeyValueList, { pairs: [{ label: "Company", value: /* @__PURE__ */ jsx("code", { children: companyId }) }] })
  ] }) });
}
function profileForPrincipal(member, agents) {
  if (member.principalType === "agent") {
    const agent = agents.find((entry) => entry.id === member.principalId);
    if (agent) {
      return {
        label: agent.name,
        secondary: [agent.title || agent.role, agent.status, agent.id].filter(Boolean).join(" / ")
      };
    }
    return {
      label: "Agent",
      secondary: member.principalId
    };
  }
  if (member.principalId.includes("@")) {
    const [localPart] = member.principalId.split("@");
    return {
      label: localPart.split(/[._-]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || member.principalId,
      secondary: member.principalId
    };
  }
  return {
    label: "Board user",
    secondary: member.principalId
  };
}
function MembersPanel({ companyId }) {
  const query = usePluginData("memberAccess", { companyId });
  const saveMemberAccess = usePluginAction("saveMemberAccess");
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [draftRole, setDraftRole] = useState("");
  const [draftStatus, setDraftStatus] = useState("active");
  const [draftGrants, setDraftGrants] = useState(/* @__PURE__ */ new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const members = query.data?.members ?? [];
  const agents = query.data?.agents ?? [];
  const editingMember = useMemo(
    () => members.find((member) => member.id === editingMemberId) ?? null,
    [members, editingMemberId]
  );
  const editingProfile = editingMember ? profileForPrincipal(editingMember, agents) : null;
  const implicitGrantKeys = useMemo(
    () => draftRole ? IMPLICIT_ROLE_GRANTS[draftRole] : [],
    [draftRole]
  );
  useEffect(() => {
    if (!editingMember) return;
    const role = editingMember.membershipRole;
    setDraftRole(role && role in HUMAN_ROLE_LABELS ? role : "");
    setDraftStatus(
      editingMember.status === "active" || editingMember.status === "pending" || editingMember.status === "suspended" ? editingMember.status : "suspended"
    );
    setDraftGrants(new Set(editingMember.grants.map((grant) => grant.permissionKey)));
    setError(null);
  }, [editingMember]);
  if (query.loading && !query.data) {
    return /* @__PURE__ */ jsx(LoadingState, { label: "Loading members" });
  }
  if (query.error) {
    return /* @__PURE__ */ jsxs("div", { style: warningStyle, children: [
      /* @__PURE__ */ jsx("strong", { children: "Could not load company members." }),
      /* @__PURE__ */ jsx("div", { children: query.error.message })
    ] });
  }
  const pendingHumans = members.filter((member) => member.principalType === "user" && member.status === "pending");
  const activeHumans = members.filter((member) => member.principalType === "user" && member.status !== "pending");
  const agentMembers = members.filter((member) => member.principalType === "agent");
  const closeEditor = () => {
    setEditingMemberId(null);
    setError(null);
  };
  async function save() {
    if (!editingMember) return;
    setBusy(true);
    setError(null);
    try {
      await saveMemberAccess({
        companyId,
        memberId: editingMember.id,
        membershipRole: draftRole || null,
        status: draftStatus,
        grants: [...draftGrants]
      });
      query.refresh();
      setEditingMemberId(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ jsxs("div", { style: layoutStack, children: [
    /* @__PURE__ */ jsx(CapabilityWarning, { warnings: query.data?.warnings ?? [] }),
    /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: { ...rowStyle, justifyContent: "space-between" }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Members" }),
          /* @__PURE__ */ jsx("strong", { children: "Company access" })
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", style: buttonStyle, onClick: () => query.refresh(), children: "Refresh" })
      ] }),
      /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Roles, membership status, and explicit permission grants for humans and agents in this company." }),
      members.length === 0 ? /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "No company members yet." }) : null,
      /* @__PURE__ */ jsx(
        MembersTable,
        {
          members: pendingHumans,
          agents,
          label: "Pending humans",
          emptyLabel: "No pending join requests",
          onEdit: setEditingMemberId
        }
      ),
      /* @__PURE__ */ jsx(
        MembersTable,
        {
          members: activeHumans,
          agents,
          label: "Humans",
          emptyLabel: "No active human members",
          onEdit: setEditingMemberId
        }
      ),
      /* @__PURE__ */ jsx(
        MembersTable,
        {
          members: agentMembers,
          agents,
          label: "Agents",
          emptyLabel: "No agent members",
          onEdit: setEditingMemberId
        }
      )
    ] }),
    editingMember && editingProfile ? /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
        /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Editing member" }),
        /* @__PURE__ */ jsx(StatusBadge, { label: editingMember.principalType === "agent" ? "Agent" : "Human", status: "info" })
      ] }),
      /* @__PURE__ */ jsx("strong", { children: editingProfile.label }),
      /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: editingProfile.secondary }),
      /* @__PURE__ */ jsxs("div", { style: gridStyle, children: [
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { style: sectionHeadingStyle, children: "Company role" }),
          /* @__PURE__ */ jsxs(
            "select",
            {
              style: inputStyle,
              value: draftRole,
              onChange: (event) => setDraftRole(event.target.value),
              children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "Unset" }),
                Object.entries(HUMAN_ROLE_LABELS).map(([value, label]) => /* @__PURE__ */ jsx("option", { value, children: label }, value))
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { style: sectionHeadingStyle, children: "Membership status" }),
          /* @__PURE__ */ jsxs(
            "select",
            {
              style: inputStyle,
              value: draftStatus,
              onChange: (event) => setDraftStatus(event.target.value),
              children: [
                /* @__PURE__ */ jsx("option", { value: "active", children: "Active" }),
                /* @__PURE__ */ jsx("option", { value: "pending", children: "Pending" }),
                /* @__PURE__ */ jsx("option", { value: "suspended", children: "Suspended" })
              ]
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: subtleCardStyle, children: [
        /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
          /* @__PURE__ */ jsx("strong", { children: "Implicit grants from role" }),
          /* @__PURE__ */ jsx(StatusBadge, { label: draftRole ? HUMAN_ROLE_LABELS[draftRole] : "No role", status: draftRole ? "info" : "pending" })
        ] }),
        /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: draftRole ? `${HUMAN_ROLE_LABELS[draftRole]} already includes these permissions automatically.` : "No role selected, so this member has no implicit grants right now." }),
        implicitGrantKeys.length > 0 ? /* @__PURE__ */ jsx("div", { style: rowStyle, children: implicitGrantKeys.map((permissionKey) => /* @__PURE__ */ jsx(StatusBadge, { label: PERMISSION_LABELS[permissionKey], status: "info" }, permissionKey)) }) : null
      ] }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Explicit grants" }),
        /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Explicit grants persist when the role changes. Scoped assignment grants are managed in the policy editor below." }),
        /* @__PURE__ */ jsx("div", { style: { ...gridStyle, marginTop: "8px" }, children: MEMBER_PERMISSION_KEYS.map((permissionKey) => {
          const isImplicit = implicitGrantKeys.includes(permissionKey);
          const isChecked = draftGrants.has(permissionKey);
          return /* @__PURE__ */ jsxs("div", { style: subtleCardStyle, children: [
            /* @__PURE__ */ jsxs("label", { style: { ...rowStyle, gap: "10px" }, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: isChecked,
                  onChange: (event) => {
                    setDraftGrants((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(permissionKey);
                      else next.delete(permissionKey);
                      return next;
                    });
                  }
                }
              ),
              /* @__PURE__ */ jsxs("span", { children: [
                /* @__PURE__ */ jsx("strong", { children: PERMISSION_LABELS[permissionKey] }),
                /* @__PURE__ */ jsx("div", { style: { ...mutedTextStyle, fontSize: "0.72rem" }, children: /* @__PURE__ */ jsx("code", { children: permissionKey }) })
              ] })
            ] }),
            isImplicit && !isChecked ? /* @__PURE__ */ jsxs("div", { style: mutedTextStyle, children: [
              "Included implicitly by the ",
              draftRole ? HUMAN_ROLE_LABELS[draftRole] : "selected",
              " role."
            ] }) : null,
            isChecked ? /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Stored explicitly for this member." }) : null
          ] }, permissionKey);
        }) })
      ] }),
      error ? /* @__PURE__ */ jsxs("div", { style: warningStyle, children: [
        /* @__PURE__ */ jsx("strong", { children: "Could not save:" }),
        " ",
        error
      ] }) : null,
      /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
        /* @__PURE__ */ jsx("button", { type: "button", style: buttonStyle, disabled: busy, onClick: closeEditor, children: "Cancel" }),
        /* @__PURE__ */ jsx("button", { type: "button", style: primaryButtonStyle, disabled: busy, onClick: () => void save(), children: busy ? /* @__PURE__ */ jsx(LoadingState, { label: "Saving access" }) : "Save access" })
      ] })
    ] }) : null
  ] });
}
function MembersTable({
  members,
  agents,
  label,
  emptyLabel,
  onEdit
}) {
  const columns = [
    { key: "principal", header: "Principal", render: (_value, row) => row.principal },
    { key: "role", header: "Role", render: (_value, row) => row.role, width: "140px" },
    { key: "status", header: "Status", render: (_value, row) => row.status, width: "120px" },
    { key: "grants", header: "Grants", render: (_value, row) => row.grants },
    { key: "action", header: "", render: (_value, row) => row.action, width: "80px" }
  ];
  const rows = members.map((member) => {
    const profile = profileForPrincipal(member, agents);
    return {
      id: member.id,
      member,
      principal: /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: "2px" }, children: [
        /* @__PURE__ */ jsx("strong", { children: profile.label }),
        /* @__PURE__ */ jsx("span", { style: mutedTextStyle, children: profile.secondary })
      ] }),
      role: member.membershipRole ? formatMode(member.membershipRole) : "Unset",
      status: /* @__PURE__ */ jsx(StatusBadge, { label: formatMode(member.status), status: membershipStatusVariant(member.status) }),
      grants: `${member.grants.length} explicit grant${member.grants.length === 1 ? "" : "s"}`,
      action: /* @__PURE__ */ jsx("button", { type: "button", style: buttonStyle, onClick: () => onEdit(member.id), children: "Edit" })
    };
  });
  return /* @__PURE__ */ jsxs("div", { style: subtleCardStyle, children: [
    /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
      /* @__PURE__ */ jsx("strong", { children: label }),
      /* @__PURE__ */ jsx(StatusBadge, { label: `${members.length}`, status: members.length > 0 ? "info" : "pending" })
    ] }),
    /* @__PURE__ */ jsx(
      DataTable,
      {
        columns,
        rows,
        emptyMessage: emptyLabel
      }
    )
  ] });
}
function GrantRows({ grants }) {
  if (grants.length === 0) {
    return /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "No assignment grants for this actor yet." });
  }
  return /* @__PURE__ */ jsx("div", { style: { display: "grid", gap: "8px" }, children: grants.map((grant, index) => /* @__PURE__ */ jsxs("div", { style: { ...rowStyle, justifyContent: "space-between", borderTop: index === 0 ? void 0 : "1px solid var(--border, #e2e8f0)", paddingTop: index === 0 ? 0 : "8px" }, children: [
    /* @__PURE__ */ jsx(StatusBadge, { label: formatPermission(grant.permissionKey), status: "info" }),
    /* @__PURE__ */ jsx("span", { style: mutedTextStyle, children: formatScope(grant.scope) })
  ] }, `${grant.permissionKey}-${index}`)) });
}
function CurrentAgentPolicy({ policy }) {
  if (!policy?.policy) {
    return /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "No saved policy. Saving below will create one." });
  }
  const visibilityMode = getPolicyString(policy.policy, "agentVisibility", "mode", "discoverable");
  const assignmentMode = getPolicyString(policy.policy, "assignmentPolicy", "mode", "company_default");
  const requiresApproval = getPolicyBoolean(policy.policy, "protectedAgent", "requiresApproval", false);
  const approvalReason = getPolicyString(policy.policy, "protectedAgent", "approvalReason", "");
  return /* @__PURE__ */ jsx(
    KeyValueList,
    {
      pairs: [
        {
          label: "Visibility",
          value: /* @__PURE__ */ jsx("span", { title: "Controls whether this agent appears in assignment and discovery surfaces.", children: formatMode(visibilityMode) })
        },
        {
          label: "Assignment",
          value: /* @__PURE__ */ jsx("span", { title: "Controls whether assignment follows company defaults or protected-agent rules.", children: formatMode(assignmentMode) })
        },
        {
          label: "Protected agent",
          value: requiresApproval ? `Requires approval${approvalReason ? `: "${approvalReason}"` : ""}` : "No approval required"
        }
      ]
    }
  );
}
function DecisionCard({ title, decision }) {
  if (!decision) return null;
  return /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
    /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
      /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: title }),
      /* @__PURE__ */ jsx(StatusBadge, { label: decisionLabel(decision.allowed), status: statusForDecision(decision.allowed) })
    ] }),
    /* @__PURE__ */ jsx("div", { children: decision.explanation }),
    /* @__PURE__ */ jsx(
      KeyValueList,
      {
        pairs: [
          { label: "Reason", value: formatMode(decision.reason) },
          { label: "Action", value: formatPermission(decision.action) },
          {
            label: "Matching grant",
            value: decision.grant ? `${formatPermission(decision.grant.permissionKey)} / ${formatScope(decision.grant.scope)}` : "No matching grant"
          }
        ]
      }
    ),
    /* @__PURE__ */ jsx(RawDisclosure, { data: decision })
  ] });
}
function AuthorizationAudit({
  entries,
  agents
}) {
  const columns = [
    { key: "time", header: "Time", render: (_value, row) => row.time, width: "170px" },
    { key: "actor", header: "Actor", render: (_value, row) => row.actor },
    { key: "action", header: "Action", render: (_value, row) => row.action },
    { key: "resource", header: "Resource", render: (_value, row) => row.resource },
    { key: "decision", header: "Decision", render: (_value, row) => row.decision, width: "120px" },
    { key: "details", header: "Details", render: (_value, row) => row.details }
  ];
  const rows = entries.map((entry) => {
    const agent = entry.actorType === "agent" ? agents.find((candidate) => candidate.id === entry.actorId) : null;
    const decision = entry.details?.decision === "deny" ? false : entry.details?.decision === "allow" ? true : null;
    return {
      id: entry.id,
      time: formatDate(entry.createdAt),
      actor: /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: "2px" }, children: [
        /* @__PURE__ */ jsx("strong", { children: agent?.name ?? formatMode(entry.actorType) }),
        /* @__PURE__ */ jsx("span", { style: mutedTextStyle, children: entry.actorId })
      ] }),
      action: formatPermission(entry.action),
      resource: `${entry.entityType} / ${entry.entityId}`,
      decision: decision === null ? /* @__PURE__ */ jsx(StatusBadge, { label: "Unknown", status: "pending" }) : /* @__PURE__ */ jsx(StatusBadge, { label: decisionLabel(decision), status: statusForDecision(decision) }),
      details: /* @__PURE__ */ jsx(RawDisclosure, { label: "Details", data: entry.details ?? {} })
    };
  });
  return /* @__PURE__ */ jsx(
    DataTable,
    {
      columns,
      rows,
      emptyMessage: "No authorization decisions in this filter window yet. Adjust the filters above to broaden the audit search."
    }
  );
}
function AdvancedPolicyEditor({ companyId }) {
  const saveAgentPolicy = usePluginAction("saveAgentPolicy");
  const saveAssignmentGrant = usePluginAction("saveAssignmentGrant");
  const [actorAgentId, setActorAgentId] = useState("");
  const [targetAgentId, setTargetAgentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [issueId, setIssueId] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditActorType, setAuditActorType] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("");
  const [auditEntityId, setAuditEntityId] = useState("");
  const [auditDecision, setAuditDecision] = useState("");
  const [visibilityMode, setVisibilityMode] = useState("discoverable");
  const [assignmentMode, setAssignmentMode] = useState("company_default");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [approvalReason, setApprovalReason] = useState("");
  const [grantMode, setGrantMode] = useState("scoped_agent");
  const [busyAction, setBusyAction] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const params = useMemo(() => ({
    companyId,
    actorAgentId,
    targetAgentId,
    projectId,
    issueId,
    auditAction,
    auditActorType,
    auditEntityType,
    auditEntityId,
    auditDecision
  }), [companyId, actorAgentId, targetAgentId, projectId, issueId, auditAction, auditActorType, auditEntityType, auditEntityId, auditDecision]);
  const query = usePluginData("advancedPolicy", params);
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    if (!actorAgentId && data.selected.actorAgentId) setActorAgentId(data.selected.actorAgentId);
    if (!targetAgentId && data.selected.targetAgentId) setTargetAgentId(data.selected.targetAgentId);
    if (!projectId && data.selected.projectId) setProjectId(data.selected.projectId);
    if (!issueId && data.selected.issueId) setIssueId(data.selected.issueId);
  }, [actorAgentId, data, issueId, projectId, targetAgentId]);
  useEffect(() => {
    const policy = data?.agentPolicy?.policy;
    setVisibilityMode(getPolicyString(policy, "agentVisibility", "mode", "discoverable"));
    setAssignmentMode(getPolicyString(policy, "assignmentPolicy", "mode", "company_default"));
    setRequiresApproval(getPolicyBoolean(policy, "protectedAgent", "requiresApproval", false));
    setApprovalReason(getPolicyString(policy, "protectedAgent", "approvalReason", ""));
  }, [data?.agentPolicy?.resourceId, data?.agentPolicy?.updatedAt]);
  const issueOptions = useMemo(
    () => (data?.issues ?? []).filter((issue) => !projectId || issue.projectId === projectId),
    [data?.issues, projectId]
  );
  async function run(label, action) {
    setBusyAction(label);
    try {
      const result = await action();
      setLastResult(result);
      query.refresh();
    } catch (error) {
      setLastResult({ error: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }
  if (query.loading && !data) {
    return /* @__PURE__ */ jsx(LoadingState, { label: "Loading advanced policy editors" });
  }
  if (query.error) {
    return /* @__PURE__ */ jsxs("div", { style: warningStyle, children: [
      /* @__PURE__ */ jsx("strong", { children: "Advanced policy APIs unavailable." }),
      /* @__PURE__ */ jsx("div", { children: query.error.message })
    ] });
  }
  const hasPreviewSelection = Boolean(actorAgentId && targetAgentId);
  return /* @__PURE__ */ jsxs("div", { style: layoutStack, children: [
    /* @__PURE__ */ jsx(CapabilityWarning, { warnings: data?.warnings ?? [] }),
    /* @__PURE__ */ jsxs("div", { style: gridStyle, children: [
      /* @__PURE__ */ jsx(MetricCard, { label: "Mode", value: formatMode(data?.summary?.permissionsMode ?? "unknown") }),
      /* @__PURE__ */ jsx(MetricCard, { label: "Active members", value: `${data?.summary?.activeMemberCount ?? 0} / ${data?.summary?.memberCount ?? 0}` }),
      /* @__PURE__ */ jsx(MetricCard, { label: "Explicit grants", value: data?.summary?.grantCount ?? 0 })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { borderTop: "1px solid var(--border, #e2e8f0)", paddingTop: "16px", display: "grid", gap: "12px" }, children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Policy preview" }),
        /* @__PURE__ */ jsx("strong", { children: "Check assignment decisions before saving policy changes" })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: gridStyle, children: [
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { style: sectionHeadingStyle, children: "Actor agent" }),
          /* @__PURE__ */ jsx(
            AssigneePicker,
            {
              companyId,
              value: actorAgentId ? `agent:${actorAgentId}` : "",
              includeUsers: false,
              placeholder: "Select actor agent",
              noneLabel: "No actor",
              onChange: (_value, selection) => setActorAgentId(selection.assigneeAgentId ?? "")
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { style: sectionHeadingStyle, children: "Target agent" }),
          /* @__PURE__ */ jsx(
            AssigneePicker,
            {
              companyId,
              value: targetAgentId ? `agent:${targetAgentId}` : "",
              includeUsers: false,
              placeholder: "Select target agent",
              noneLabel: "No target",
              onChange: (_value, selection) => setTargetAgentId(selection.assigneeAgentId ?? "")
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { style: sectionHeadingStyle, children: "Project scope" }),
          /* @__PURE__ */ jsx(
            ProjectPicker,
            {
              companyId,
              value: projectId,
              placeholder: "Any project",
              noneLabel: "Any project",
              onChange: setProjectId
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { style: sectionHeadingStyle, children: "Issue context" }),
          /* @__PURE__ */ jsxs("select", { style: inputStyle, value: issueId, onChange: (event) => setIssueId(event.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "No issue" }),
            issueOptions.map((issue) => /* @__PURE__ */ jsx("option", { value: issue.id, children: issue.title }, issue.id))
          ] })
        ] })
      ] }),
      !hasPreviewSelection ? /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Select an actor and target agent to preview a policy decision." }) : /* @__PURE__ */ jsxs("div", { style: gridStyle, children: [
        /* @__PURE__ */ jsx(DecisionCard, { title: "Preview Decision", decision: data?.preview ?? null }),
        /* @__PURE__ */ jsx(DecisionCard, { title: "Permission Explanation", decision: data?.explanation ?? null })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: gridStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
        /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Agent Visibility" }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Directory mode" }),
          /* @__PURE__ */ jsxs("select", { style: inputStyle, value: visibilityMode, onChange: (event) => setVisibilityMode(event.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "discoverable", children: "Discoverable" }),
            /* @__PURE__ */ jsx("option", { value: "private", children: "Private" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Assignment mode" }),
          /* @__PURE__ */ jsxs("select", { style: inputStyle, value: assignmentMode, onChange: (event) => setAssignmentMode(event.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "company_default", children: "Company default" }),
            /* @__PURE__ */ jsx("option", { value: "protected", children: "Protected" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: rowStyle, children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: requiresApproval, onChange: (event) => setRequiresApproval(event.target.checked) }),
          /* @__PURE__ */ jsx("span", { children: "Require approval for protected assignment" })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Approval reason" }),
          /* @__PURE__ */ jsx("input", { style: inputStyle, value: approvalReason, onChange: (event) => setApprovalReason(event.target.value) })
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            style: primaryButtonStyle,
            disabled: !targetAgentId || busyAction !== null,
            onClick: () => void run("policy", () => saveAgentPolicy({
              companyId,
              agentId: targetAgentId,
              visibilityMode,
              assignmentMode,
              requiresApproval,
              approvalReason
            })),
            children: busyAction === "policy" ? /* @__PURE__ */ jsx(LoadingState, { label: "Saving agent policy" }) : "Save agent policy"
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
        /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Assignment Policy" }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Grant mode" }),
          /* @__PURE__ */ jsxs("select", { style: inputStyle, value: grantMode, onChange: (event) => setGrantMode(event.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "scoped_agent", children: "Scoped to selected target" }),
            /* @__PURE__ */ jsx("option", { value: "broad", children: "Broad assignment" }),
            /* @__PURE__ */ jsx("option", { value: "clear", children: "Clear assignment grants" })
          ] })
        ] }),
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            style: primaryButtonStyle,
            disabled: !actorAgentId || busyAction !== null,
            onClick: () => void run("grants", () => saveAssignmentGrant({
              companyId,
              actorAgentId,
              targetAgentId,
              projectId,
              mode: grantMode
            })),
            children: busyAction === "grants" ? /* @__PURE__ */ jsx(LoadingState, { label: "Saving assignment grants" }) : "Save assignment grants"
          }
        ),
        /* @__PURE__ */ jsx(GrantRows, { grants: data?.actorGrants ?? [] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
      /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Current Agent Policy" }),
      /* @__PURE__ */ jsx(CurrentAgentPolicy, { policy: data?.agentPolicy ?? null })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: { ...rowStyle, justifyContent: "space-between" }, children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Authorization Audit" }),
          /* @__PURE__ */ jsx("strong", { children: "Recent authorization decisions" })
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", style: buttonStyle, onClick: () => query.refresh(), children: "Refresh" })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { ...gridStyle, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }, children: [
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Action" }),
          /* @__PURE__ */ jsx("input", { style: inputStyle, value: auditAction, onChange: (event) => setAuditAction(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Actor type" }),
          /* @__PURE__ */ jsxs("select", { style: inputStyle, value: auditActorType, onChange: (event) => setAuditActorType(event.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Any actor" }),
            /* @__PURE__ */ jsx("option", { value: "agent", children: "Agent" }),
            /* @__PURE__ */ jsx("option", { value: "user", children: "User" }),
            /* @__PURE__ */ jsx("option", { value: "plugin", children: "Plugin" }),
            /* @__PURE__ */ jsx("option", { value: "system", children: "System" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Resource type" }),
          /* @__PURE__ */ jsx("input", { style: inputStyle, value: auditEntityType, onChange: (event) => setAuditEntityType(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Resource id" }),
          /* @__PURE__ */ jsx("input", { style: inputStyle, value: auditEntityId, onChange: (event) => setAuditEntityId(event.target.value) })
        ] }),
        /* @__PURE__ */ jsxs("label", { style: fieldStyle, children: [
          /* @__PURE__ */ jsx("span", { children: "Decision" }),
          /* @__PURE__ */ jsxs("select", { style: inputStyle, value: auditDecision, onChange: (event) => setAuditDecision(event.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Any decision" }),
            /* @__PURE__ */ jsx("option", { value: "allow", children: "Allow" }),
            /* @__PURE__ */ jsx("option", { value: "deny", children: "Deny" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsx(AuthorizationAudit, { entries: data?.auditEntries ?? [], agents: data?.agents ?? [] })
    ] }),
    lastResult ? /* @__PURE__ */ jsx(RawDisclosure, { label: "Last saved raw response", data: lastResult }) : null
  ] });
}
function EePermissionsCompanySettingsPageContent(_props) {
  const hostContext = useHostContext();
  const companyId = hostContext.companyId;
  const overview = usePluginData("overview", companyId ? { companyId } : {});
  const activate = usePluginAction("activateLicense");
  const deactivate = usePluginAction("deactivateLicense");
  const [activationBusy, setActivationBusy] = useState(false);
  if (!companyId) return /* @__PURE__ */ jsx(MissingCompanyState, {});
  if (overview.loading && !overview.data) {
    return /* @__PURE__ */ jsx("div", { style: layoutStack, children: /* @__PURE__ */ jsx("div", { style: cardStyle, children: /* @__PURE__ */ jsx(LoadingState, { label: "Loading permissions overview" }) }) });
  }
  if (overview.error) {
    return /* @__PURE__ */ jsx("div", { style: layoutStack, children: /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
      /* @__PURE__ */ jsx("div", { style: sectionHeadingStyle, children: "Permissions" }),
      /* @__PURE__ */ jsx("strong", { children: "Could not load permissions" }),
      /* @__PURE__ */ jsxs("div", { style: mutedTextStyle, children: [
        /* @__PURE__ */ jsx("code", { children: overview.error.code }),
        ": ",
        overview.error.message
      ] })
    ] }) });
  }
  const data = overview.data;
  if (!data) {
    return /* @__PURE__ */ jsx("div", { style: layoutStack, children: /* @__PURE__ */ jsx("div", { style: cardStyle, children: /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "No permissions data returned yet." }) }) });
  }
  if (data.license.status !== "active") {
    return /* @__PURE__ */ jsx(
      UnlicensedState,
      {
        companyId,
        activating: activationBusy,
        onActivate: () => {
          setActivationBusy(true);
          void activate({ companyId }).then(() => overview.refresh()).finally(() => setActivationBusy(false));
        }
      }
    );
  }
  return /* @__PURE__ */ jsxs("div", { style: layoutStack, children: [
    /* @__PURE__ */ jsxs("div", { style: cardStyle, children: [
      /* @__PURE__ */ jsxs("div", { style: rowStyle, children: [
        /* @__PURE__ */ jsx("strong", { children: "Advanced policy editing is active" }),
        /* @__PURE__ */ jsx(StatusBadge, { label: "Active", status: "ok" }),
        /* @__PURE__ */ jsxs("details", { children: [
          /* @__PURE__ */ jsx("summary", { style: { ...mutedTextStyle, cursor: "pointer" }, children: "About enforcement" }),
          /* @__PURE__ */ jsx("div", { style: mutedTextStyle, children: "Policy data stays in core. If this plugin is unavailable later, existing restrictions remain server-enforced." })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          style: buttonStyle,
          disabled: activationBusy,
          onClick: () => {
            setActivationBusy(true);
            void deactivate({ companyId }).then(() => overview.refresh()).finally(() => setActivationBusy(false));
          },
          children: activationBusy ? /* @__PURE__ */ jsx(LoadingState, { label: "Updating" }) : "Deactivate"
        }
      ) })
    ] }),
    /* @__PURE__ */ jsx(MembersPanel, { companyId }),
    /* @__PURE__ */ jsx(AdvancedPolicyEditor, { companyId })
  ] });
}
function EePermissionsCompanySettingsPage(props) {
  return /* @__PURE__ */ jsx(ErrorBoundary, { fallback: /* @__PURE__ */ jsx("div", { style: warningStyle, children: "The Paperclip EE permissions UI could not render." }), children: /* @__PURE__ */ jsx(EePermissionsCompanySettingsPageContent, { ...props }) });
}
export {
  EePermissionsCompanySettingsPage
};
//# sourceMappingURL=index.js.map
