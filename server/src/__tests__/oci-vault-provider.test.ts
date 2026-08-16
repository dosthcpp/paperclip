import { describe, expect, it } from "vitest";
import { createOciVaultProvider } from "../secrets/oci-vault-provider.js";

const vault = { id: "oci-vault", provider: "oci_vault" as const, status: "ready", config: { region: "ap-seoul-1", vaultOcid: "ocid1.vault.oc1.ap-seoul-1.example", secretOcidPrefix: "ocid1.vaultsecret.oc1.ap-seoul-1." } };

describe("ociVaultProvider", () => {
  it("stores an external reference as metadata only", async () => {
    const prepared = await createOciVaultProvider().linkExternalSecret({ externalRef: "ocid1.vaultsecret.oc1.ap-seoul-1.example", providerVersionRef: "7", providerConfig: vault });
    expect(JSON.stringify(prepared)).not.toContain("secret-value");
    expect(prepared.material).toMatchObject({ scheme: "oci_vault_v1" });
  });
  it("uses instance-principal OCI CLI resolution", async () => {
    const calls: string[][] = [];
    const provider = createOciVaultProvider({ run: async (args) => { calls.push(args); return { exitCode: 0, stdout: Buffer.from("fixture-value").toString("base64"), stderr: "" }; } });
    await expect(provider.resolveVersion({ material: {}, externalRef: "ocid1.vaultsecret.oc1.ap-seoul-1.example", providerVersionRef: "7", providerConfig: vault })).resolves.toBe("fixture-value");
    expect(calls[0]).toEqual(expect.arrayContaining(["--auth", "instance_principal", "--secret-id", "ocid1.vaultsecret.oc1.ap-seoul-1.example", "--version-number", "7"]));
  });
  it("rejects references outside the configured OCI prefix", async () => {
    await expect(createOciVaultProvider().linkExternalSecret({ externalRef: "ocid1.vaultsecret.oc1.us-ashburn-1.example", providerConfig: vault })).rejects.toThrow(/approved OCI secret OCIDs/i);
  });
});
