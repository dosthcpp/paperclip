import type { UIAdapterModule } from "../types";
import { parseHermesStdoutLine } from "@paperclipai/adapter-hermes-local/ui";
import { buildHermesConfig } from "@paperclipai/adapter-hermes-local/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const hermesLocalUIAdapter: UIAdapterModule = {
  type: "hermes_local",
  label: "Hermes Agent",
  parseStdoutLine: parseHermesStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildHermesConfig,
};
