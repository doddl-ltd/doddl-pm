-- Migration: 18-agent-keys
-- Description: Per-agent PM API keys (sha256 only). Plaintext keys are in Key
--              Vault doddl-kv-prod as pm-agent-key-<agent_id>. Minted with
--              scripts/mint-agent-key.ps1. Hashes are safe to commit.

INSERT INTO public.agent_keys (agent_id, key_hash, key_prefix, scopes, label)
VALUES ('doddl-transcribe', 'b328b59308722088cffadd5681b54ae03191aac95bffd353e7aedbc908cb6477', 'dpm_TRU4', ARRAY['inbox:write', 'tasks:read'], 'doddl-transcribe meeting notes service')
ON CONFLICT (key_hash) DO NOTHING;

INSERT INTO public.agent_keys (agent_id, key_hash, key_prefix, scopes, label)
VALUES ('claude-agents', '7253b85bb9a72a6c4d25d07c35dfc7a712643e4b1233ba17d553b0690ee27009', 'dpm_XOUx', ARRAY['tasks:read', 'tasks:write', 'inbox:write', 'approvals:write'], 'Headless Claude agents (Claude Code cloud runs, doddl-ads, analytics)')
ON CONFLICT (key_hash) DO NOTHING;
