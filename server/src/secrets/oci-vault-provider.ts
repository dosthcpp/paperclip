import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { unprocessable } from "../errors.js";
import { SecretProviderClientError, type PreparedSecretVersion, type SecretProviderModule, type SecretProviderVaultRuntimeConfig } from "./types.js";

const SECRET_OCID = /^ocid1\.vaultsecret\.[a-z0-9.-]+$/i;
const VERSION = /^\d+$/;
type Result = { exitCode: number; stdout: string; stderr: string };
type Runner = (args: string[]) => Promise<Result>;

function runOci(args: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("oci", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

function config(input?: SecretProviderVaultRuntimeConfig | null) {
  if (!input || input.provider !== "oci_vault") throw unprocessable("OCI Vault requires a ready provider vault configuration");
  const region = typeof input.config.region === "string" ? input.config.region.trim() : "";
  const vaultOcid = typeof input.config.vaultOcid === "string" ? input.config.vaultOcid.trim() : "";
  const prefix = typeof input.config.secretOcidPrefix === "string" ? input.config.secretOcidPrefix.trim() : "";
  if (!region || !vaultOcid) throw unprocessable("OCI Vault provider vault is missing required routing metadata");
  return { region, prefix };
}

function ref(value: string, prefix = "") {
  const result = value.trim();
  if (!SECRET_OCID.test(result) || (prefix && !result.startsWith(prefix))) throw unprocessable("OCI Vault external references must be approved OCI secret OCIDs");
  return result;
}

function metadata(externalRef: string, providerVersionRef?: string | null): PreparedSecretVersion {
  const version = providerVersionRef?.trim() || null;
  if (version && !VERSION.test(version)) throw unprocessable("OCI Vault version references must be positive integers");
  const fingerprint = createHash("sha256").update(`oci_vault:${externalRef}:${version ?? ""}`).digest("hex");
  return { material: { scheme: "oci_vault_v1", externalRef, providerVersionRef: version }, valueSha256: fingerprint, fingerprintSha256: fingerprint, externalRef, providerVersionRef: version };
}

export function createOciVaultProvider(input: { run?: Runner } = {}): SecretProviderModule {
  const run = input.run ?? runOci;
  return {
    id: "oci_vault",
    descriptor: () => ({ id: "oci_vault", label: "Oracle Cloud Infrastructure Vault", requiresExternalRef: true, supportsManagedValues: false, supportsExternalReferences: true, configured: true }),
    async validateConfig({ providerConfig } = {}) { try { config(providerConfig); return { ok: true, warnings: [] }; } catch (error) { return { ok: false, warnings: [error instanceof Error ? error.message : "Invalid OCI Vault configuration"] }; } },
    async createSecret() { throw unprocessable("OCI Vault supports external references only; Paperclip never writes Oracle secret values"); },
    async createVersion() { throw unprocessable("OCI Vault supports external references only; rotate values in OCI Vault"); },
    async linkExternalSecret({ externalRef, providerVersionRef, providerConfig }) { return metadata(ref(externalRef, config(providerConfig).prefix), providerVersionRef); },
    async resolveVersion({ externalRef, providerVersionRef, providerConfig }) {
      const runtime = config(providerConfig); const secret = ref(externalRef ?? "", runtime.prefix);
      const args = ["--region", runtime.region, "--auth", "instance_principal", "secrets", "secret-bundle", "get", "--secret-id", secret, "--stage", "CURRENT", "--query", 'data."secret-bundle-content".content', "--raw-output"];
      if (providerVersionRef?.trim()) args.splice(9, 0, "--version-number", providerVersionRef.trim());
      let result: Result; try { result = await run(args); } catch { throw new SecretProviderClientError({ code: "provider_unavailable", provider: "oci_vault", operation: "resolve", message: "OCI Vault CLI is unavailable" }); }
      if (result.exitCode !== 0) throw new SecretProviderClientError({ code: "provider_error", provider: "oci_vault", operation: "resolve", message: "OCI Vault could not resolve the referenced secret" });
      const encoded = result.stdout.trim();
      if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new SecretProviderClientError({ code: "provider_error", provider: "oci_vault", operation: "resolve", message: "OCI Vault returned an invalid secret bundle" });
      return Buffer.from(encoded, "base64").toString("utf8");
    },
    async deleteOrArchive() { /* Provider values are never mutated by Paperclip. */ },
    async healthCheck({ providerConfig } = {}) { try { config(providerConfig); const result = await run(["--version"]); return result.exitCode === 0 ? { provider: "oci_vault", status: "ok", message: "OCI Vault is configured for instance-principal secret resolution" } : { provider: "oci_vault", status: "error", message: "OCI CLI is unavailable or failed its health check" }; } catch (error) { return { provider: "oci_vault", status: "error", message: error instanceof Error ? error.message : "OCI Vault configuration is invalid" }; } },
  };
}

export const ociVaultProvider = createOciVaultProvider();
