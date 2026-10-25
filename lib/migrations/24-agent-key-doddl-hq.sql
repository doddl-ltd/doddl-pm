-- Migration: 24-agent-key-doddl-hq
-- Description: Per-agent PM API keys (sha256 only). Plaintext keys are in Key
--              Vault doddl-kv-prod as pm-agent-key-<agent_id>. Minted with
--              scripts/mint-agent-key.ps1. Hashes are safe to commit.

INSERT INTO public.agent_keys (agent_id, key_hash, key_prefix, scopes, label)
VALUES ('doddl-hq', '8e8dde32d29715093794bc7ffa73e5c13a313ae9975d4b075a8a68e6ca936795', 'dpm_VQZI', ARRAY['tasks:read', 'tasks:write', 'approvals:write'], 'Doddl HQ approval bridge (submits approvals, never decides)')
ON CONFLICT (key_hash) DO NOTHING;