const COMPANY_ID = "comp_demo_5cbe79ee";

const baseHost = { companyId: COMPANY_ID, companyPrefix: "PAP", theme: "light" };

const overviewInactive = {
  loading: false,
  error: null,
  data: {
    companyId: COMPANY_ID,
    license: { status: "inactive" },
    policySummary: null,
    warnings: [],
  },
};

const overviewActive = {
  loading: false,
  error: null,
  data: {
    companyId: COMPANY_ID,
    license: {
      status: "active",
      activatedAt: "2026-05-14T12:00:00.000Z",
      activatedByUserId: "usr_dotta",
      note: null,
    },
    policySummary: {
      companyId: COMPANY_ID,
      permissionsMode: "simple",
      memberCount: 4,
      activeMemberCount: 3,
      grantCount: 5,
      advancedPolicyAvailable: false,
    },
    warnings: [],
  },
};

const populatedMembers = {
  loading: false,
  error: null,
  data: {
    companyId: COMPANY_ID,
    warnings: [],
    agents: [
      { id: "agt_uxdesigner", name: "UXDesigner", role: "designer", status: "active" },
      { id: "agt_qa_agent", name: "QAAgent", role: "qa", status: "active" },
    ],
    members: [
      {
        id: "mem_h1",
        companyId: COMPANY_ID,
        principalType: "user",
        principalId: "dotta@magicmachine.co",
        status: "active",
        membershipRole: "owner",
        grants: [
          { permissionKey: "agents:create", scope: null },
          { permissionKey: "users:invite", scope: null },
        ],
      },
      {
        id: "mem_h2",
        companyId: COMPANY_ID,
        principalType: "user",
        principalId: "rivka@magicmachine.co",
        status: "active",
        membershipRole: "operator",
        grants: [{ permissionKey: "tasks:assign", scope: null }],
      },
      {
        id: "mem_h3",
        companyId: COMPANY_ID,
        principalType: "user",
        principalId: "auditor@vendor.com",
        status: "suspended",
        membershipRole: "viewer",
        grants: [],
      },
      {
        id: "mem_a1",
        companyId: COMPANY_ID,
        principalType: "agent",
        principalId: "agt_uxdesigner",
        status: "active",
        membershipRole: null,
        grants: [{ permissionKey: "tasks:assign", scope: null }],
      },
      {
        id: "mem_a2",
        companyId: COMPANY_ID,
        principalType: "agent",
        principalId: "agt_qa_agent",
        status: "active",
        membershipRole: null,
        grants: [],
      },
    ],
  },
};

const pendingMember = {
  loading: false,
  error: null,
  data: {
    companyId: COMPANY_ID,
    warnings: [],
    agents: populatedMembers.data.agents,
    members: [
      {
        id: "mem_h_pending",
        companyId: COMPANY_ID,
        principalType: "user",
        principalId: "new-hire@magicmachine.co",
        status: "pending",
        membershipRole: "operator",
        grants: [],
      },
      ...populatedMembers.data.members.slice(0, 2),
    ],
  },
};

const advancedActive = {
  loading: false,
  error: null,
  data: {
    summary: overviewActive.data.policySummary,
    warnings: [],
    agents: [
      { id: "agt_cto", name: "CTO", role: "manager", status: "active" },
      { id: "agt_uxdesigner", name: "UXDesigner", role: "designer", status: "active" },
      { id: "agt_qa_agent", name: "QAAgent", role: "qa", status: "active" },
      { id: "agt_protected_eng", name: "PaymentsEngineer", role: "engineer", status: "active" },
    ],
    issues: [
      { id: "iss_1", title: "Roll out billing redesign", status: "in_progress", projectId: "proj_billing" },
      { id: "iss_2", title: "Audit log retention policy", status: "todo", projectId: "proj_compliance" },
      { id: "iss_3", title: "Customer churn dashboard", status: "todo", projectId: "proj_data" },
    ],
    selected: {
      actorAgentId: "agt_uxdesigner",
      targetAgentId: "agt_protected_eng",
      projectId: "proj_billing",
      issueId: null,
    },
    agentPolicy: {
      resourceType: "agent",
      resourceId: "agt_protected_eng",
      policy: {
        agentVisibility: { mode: "discoverable" },
        assignmentPolicy: { mode: "protected" },
        protectedAgent: {
          requiresApproval: true,
          approvalReason: "Payments routing changes require manager approval.",
        },
      },
      updatedAt: "2026-05-17T14:08:11.221Z",
    },
    actorGrants: [
      { permissionKey: "tasks:assign", scope: null },
      { permissionKey: "tasks:assign_scope", scope: { projectId: "proj_billing" } },
    ],
    preview: {
      allowed: true,
      action: "tasks:assign",
      reason: "scoped_grant",
      explanation: "UXDesigner can assign tasks in proj_billing because they hold a scoped tasks:assign_scope grant.",
      grant: { permissionKey: "tasks:assign_scope", scope: { projectId: "proj_billing" } },
    },
    explanation: {
      allowed: true,
      action: "tasks:assign",
      reason: "scoped_grant",
      explanation: "Explicit scoped grant takes precedence over the protected-agent default deny.",
    },
    auditEntries: [
      {
        id: "aud_1",
        actorType: "agent",
        actorId: "agt_uxdesigner",
        action: "tasks:assign",
        entityType: "issue",
        entityId: "iss_1",
        details: { decision: "allow", reason: "scoped_grant" },
        createdAt: "2026-05-18T16:42:01.110Z",
      },
      {
        id: "aud_2",
        actorType: "agent",
        actorId: "agt_qa_agent",
        action: "tasks:assign",
        entityType: "issue",
        entityId: "iss_2",
        details: { decision: "deny", reason: "protected_agent" },
        createdAt: "2026-05-18T15:14:58.001Z",
      },
    ],
  },
};

const advancedDeny = {
  ...advancedActive,
  data: {
    ...advancedActive.data,
    preview: {
      allowed: false,
      action: "tasks:assign",
      reason: "protected_agent",
      explanation: "PaymentsEngineer is protected. Approval from the company owner is required before assignment.",
    },
    explanation: {
      allowed: false,
      action: "tasks:assign",
      reason: "protected_agent",
      explanation: "Protected-agent policy denies assignment without an approval workflow.",
    },
  },
};

const emptyMembers = {
  loading: false,
  error: null,
  data: { companyId: COMPANY_ID, warnings: [], members: [], agents: [] },
};

const emptyAdvanced = {
  loading: false,
  error: null,
  data: {
    summary: overviewActive.data.policySummary,
    warnings: [],
    agents: [],
    issues: [],
    selected: { actorAgentId: null, targetAgentId: null, projectId: null, issueId: null },
    agentPolicy: null,
    actorGrants: [],
    preview: null,
    explanation: null,
    auditEntries: [],
  },
};

const deniedWarnings = [
  {
    code: "CAPABILITY_DENIED",
    message: "access.members.read is not granted to this plugin version.",
  },
];

const staleWarnings = [
  {
    code: "BACKEND_UNAVAILABLE",
    message: "Authorization audit search returned 503. Existing policy is still enforced by core.",
  },
];

export const STATES = {
  missingCompany: {
    host: { ...baseHost, companyId: null },
    data: { overview: { loading: false, error: null, data: null } },
  },
  loading: {
    host: baseHost,
    data: { overview: { loading: true, error: null, data: null } },
  },
  unlicensed: {
    host: baseHost,
    data: { overview: overviewInactive },
  },
  empty: {
    host: baseHost,
    data: {
      overview: overviewActive,
      memberAccess: emptyMembers,
      advancedPolicy: emptyAdvanced,
    },
  },
  populated: {
    host: baseHost,
    data: {
      overview: overviewActive,
      memberAccess: populatedMembers,
      advancedPolicy: advancedActive,
    },
  },
  pending: {
    host: baseHost,
    data: {
      overview: overviewActive,
      memberAccess: pendingMember,
      advancedPolicy: emptyAdvanced,
    },
  },
  denied: {
    host: baseHost,
    data: {
      overview: {
        ...overviewActive,
        data: { ...overviewActive.data, warnings: deniedWarnings },
      },
      memberAccess: {
        ...populatedMembers,
        data: { ...populatedMembers.data, warnings: deniedWarnings },
      },
      advancedPolicy: {
        ...advancedActive,
        data: { ...advancedActive.data, warnings: deniedWarnings },
      },
    },
  },
  stale: {
    host: baseHost,
    data: {
      overview: {
        ...overviewActive,
        data: { ...overviewActive.data, warnings: staleWarnings },
      },
      memberAccess: {
        ...populatedMembers,
        data: { ...populatedMembers.data, warnings: staleWarnings },
      },
      advancedPolicy: {
        ...advancedActive,
        data: { ...advancedActive.data, warnings: staleWarnings },
      },
    },
  },
  error: {
    host: baseHost,
    data: {
      overview: {
        loading: false,
        error: { code: "INTERNAL_ERROR", message: "Worker crashed loading overview." },
        data: null,
      },
    },
  },
  deny: {
    host: baseHost,
    data: {
      overview: overviewActive,
      memberAccess: populatedMembers,
      advancedPolicy: advancedDeny,
    },
  },
};
