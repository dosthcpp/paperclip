// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAccessGate } from "./components/CloudAccessGate";

const mockHealthApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

const mockAccessApi = vi.hoisted(() => ({
  getCurrentBoardAccess: vi.fn(),
  claimBootstrapAdmin: vi.fn(),
}));

vi.mock("./api/health", () => ({
  healthApi: mockHealthApi,
}));

vi.mock("./api/auth", () => ({
  authApi: mockAuthApi,
}));

vi.mock("./api/access", () => ({
  accessApi: mockAccessApi,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  Navigate: ({ to }: { to: string }) => <div>Navigate:{to}</div>,
  Outlet: () => <div>Outlet content</div>,
  Route: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Routes: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useLocation: () => ({ pathname: "/instance/settings/general", search: "", hash: "" }),
  useParams: () => ({}),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function waitForText(container: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await flushReact();
  }
  expect(container.textContent).toContain(text);
}

describe("CloudAccessGate", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockHealthApi.get.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bootstrapStatus: "ready",
    });
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows a no-access message for signed-in users without org access", async () => {
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "user@example.com", name: "User", image: null },
    });
    mockAccessApi.getCurrentBoardAccess.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", name: "User", image: null },
      userId: "user-1",
      isInstanceAdmin: false,
      companyIds: [],
      source: "session",
      keyId: null,
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CloudAccessGate />
        </QueryClientProvider>,
      );
    });
    await waitForText(container, "No company access");

    expect(container.textContent).toContain("No company access");
    expect(container.textContent).not.toContain("Outlet content");

    flushSync(() => {
      root.unmount();
    });
  });

  it("allows authenticated users with company access through to the board", async () => {
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "user@example.com", name: "User", image: null },
    });
    mockAccessApi.getCurrentBoardAccess.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", name: "User", image: null },
      userId: "user-1",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
      source: "session",
      keyId: null,
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CloudAccessGate />
        </QueryClientProvider>,
      );
    });
    await waitForText(container, "Outlet content");

    expect(container.textContent).toContain("Outlet content");
    expect(container.textContent).not.toContain("No company access");

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows browser sign-in setup for signed-out private bootstrap-pending instances", async () => {
    mockHealthApi.get.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bootstrapStatus: "bootstrap_pending",
      bootstrapInviteActive: false,
    });
    mockAuthApi.getSession.mockResolvedValue(null);

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CloudAccessGate />
        </QueryClientProvider>,
      );
    });
    await waitForText(container, "Finish setting up this Paperclip");

    expect(container.textContent).toContain("Finish setting up this Paperclip");
    expect(container.textContent).toContain("Sign in / Create account");
    expect(container.textContent).toContain("pnpm paperclipai auth bootstrap-ceo");
    expect(mockAccessApi.getCurrentBoardAccess).not.toHaveBeenCalled();

    flushSync(() => {
      root.unmount();
    });
  });

  it("shows the claim action for signed-in private bootstrap-pending instances", async () => {
    mockHealthApi.get.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bootstrapStatus: "bootstrap_pending",
      bootstrapInviteActive: false,
    });
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "user@example.com", name: "User", image: null },
    });
    mockAccessApi.claimBootstrapAdmin.mockResolvedValue({ claimed: true, userId: "user-1" });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CloudAccessGate />
        </QueryClientProvider>,
      );
    });
    await waitForText(container, "Claim this instance");

    expect(container.textContent).toContain("Claim this instance");
    expect(container.textContent).toContain("Signed in as user@example.com");
    expect(mockAccessApi.getCurrentBoardAccess).not.toHaveBeenCalled();

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Claim this instance"),
    );
    expect(button).toBeTruthy();
    flushSync(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForText(container, "You're the instance admin");

    expect(mockAccessApi.claimBootstrapAdmin).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("You're the instance admin");

    flushSync(() => {
      root.unmount();
    });
  });

  it("keeps public bootstrap-pending instances invite-only", async () => {
    mockHealthApi.get.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      bootstrapStatus: "bootstrap_pending",
      bootstrapInviteActive: true,
    });
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", email: "user@example.com", name: "User", image: null },
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    flushSync(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CloudAccessGate />
        </QueryClientProvider>,
      );
    });
    await waitForText(container, "This Paperclip is waiting on its first admin");

    expect(container.textContent).toContain("This Paperclip is waiting on its first admin");
    expect(container.textContent).toContain("invite-only mode");
    expect(container.textContent).not.toContain("Claim this instance");
    expect(container.textContent).not.toContain("Sign in / Create account");
    expect(mockAccessApi.claimBootstrapAdmin).not.toHaveBeenCalled();

    flushSync(() => {
      root.unmount();
    });
  });
});
