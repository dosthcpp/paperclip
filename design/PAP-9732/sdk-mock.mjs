import { Component, createContext, createElement, useContext } from "react";

const MockContext = createContext(null);

export function MockProvider({ value, children }) {
  return createElement(MockContext.Provider, { value }, children);
}

export function useHostContext() {
  const ctx = useContext(MockContext);
  return ctx?.host ?? { companyId: null, companyPrefix: null, theme: "light" };
}

export function usePluginData(name, params) {
  const ctx = useContext(MockContext);
  const entry = ctx?.data?.[name];
  if (!entry) {
    return { loading: false, error: null, data: null, refresh: () => {}, params };
  }
  return {
    loading: entry.loading ?? false,
    error: entry.error ?? null,
    data: entry.data ?? null,
    refresh: () => {},
    params,
  };
}

export function usePluginAction() {
  return async () => ({});
}

export function MetricCard({ label, value, unit }) {
  return createElement("div", { className: "sdk-metric-card" }, [
    createElement("div", { key: "label", className: "sdk-muted" }, label),
    createElement("strong", { key: "value" }, `${value}${unit ?? ""}`),
  ]);
}

export function StatusBadge({ label, status }) {
  return createElement("span", { className: `sdk-status sdk-status-${status}` }, label);
}

export function DataTable({ columns, rows, emptyMessage }) {
  if (!rows?.length) {
    return createElement("div", { className: "sdk-muted" }, emptyMessage ?? "No rows.");
  }
  return createElement("div", { className: "sdk-table" }, rows.map((row) =>
    createElement("div", { key: row.id, className: "sdk-table-row" }, columns.map((column) =>
      createElement("div", { key: column.key, className: "sdk-table-cell" }, [
        createElement("div", { key: "h", className: "sdk-table-header" }, column.header),
        createElement("div", { key: "v" }, column.render ? column.render(row[column.key], row) : row[column.key]),
      ]),
    )),
  ));
}

export function KeyValueList({ pairs }) {
  return createElement("dl", { className: "sdk-kv" }, pairs.flatMap((pair) => [
    createElement("dt", { key: `${pair.label}-k` }, pair.label),
    createElement("dd", { key: `${pair.label}-v` }, pair.value),
  ]));
}

export function JsonTree({ data }) {
  return createElement("code", { className: "sdk-json" }, JSON.stringify(data, null, 2));
}

export function Spinner({ label }) {
  return createElement("span", { className: "sdk-spinner", "aria-label": label ?? "Loading" });
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) return this.props.fallback ?? createElement("div", null, "Plugin error");
    return this.props.children;
  }
}

export function AssigneePicker({ value, onChange, placeholder, noneLabel }) {
  return createElement("button", {
    type: "button",
    className: "sdk-picker",
    onClick: () => onChange(value, { assigneeAgentId: value.startsWith("agent:") ? value.slice(6) : null, assigneeUserId: null }),
  }, value ? value.replace(/^agent:/, "") : (placeholder ?? noneLabel ?? "Assignee"));
}

export function ProjectPicker({ value, placeholder, noneLabel, onChange }) {
  return createElement("button", {
    type: "button",
    className: "sdk-picker",
    onClick: () => onChange(value),
  }, value || placeholder || noneLabel || "Project");
}
