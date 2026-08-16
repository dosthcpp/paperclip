# OCI Vault external-reference provider

`oci_vault` resolves an existing OCI Vault secret only through Paperclip's run-bound secret broker. It never accepts, stores, logs, creates, rotates, or deletes secret values.

Create a ready provider vault with routing metadata only:

```json
{"provider":"oci_vault","displayName":"OCI production vault","status":"ready","config":{"region":"ap-seoul-1","vaultOcid":"ocid1.vault.oc1.ap-seoul-1.example","compartmentOcid":"ocid1.compartment.oc1.ap-seoul-1.example","secretOcidPrefix":"ocid1.vaultsecret.oc1.ap-seoul-1."}}
```

The runtime host needs OCI CLI plus a workload-bound OCI instance principal with read-only access to the approved secret OCID prefix. Do not store OCI API keys, private keys, session tokens, or values in Paperclip. Link an OCI secret OCID and optional numeric version; the authorized runtime receives the value only from `POST /api/agents/me/secrets/:key/value`.
