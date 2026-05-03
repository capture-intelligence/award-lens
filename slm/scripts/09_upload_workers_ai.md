# Deploying the LoRA to Cloudflare Workers AI

After training (script `06_train.py`) finishes you'll have a PEFT adapter at:

    slm/out/llama31-8b-awards-sql/

This is what you upload to Workers AI as a "BYO LoRA" finetune. The base
model on the Workers AI side is `@cf/meta/llama-3.1-8b-instruct-fast`.

## Constraints (already met by `06_train.py`)

| Constraint           | Workers AI limit          | Our config          |
|----------------------|---------------------------|---------------------|
| Base model           | Llama-3.1-8B-Instruct     | ✅                  |
| Target modules       | q_proj, k_proj, v_proj, o_proj | ✅              |
| LoRA rank            | ≤ 16                      | r=16                |
| LoRA alpha           | ≤ 32                      | alpha=32            |
| Max adapter size     | ≈ 100 MB                  | ~30 MB at r=16      |
| File format          | `adapter_config.json` + `adapter_model.safetensors` | PEFT default ✅ |

## One-time Cloudflare auth

Same wrangler login you already did. Verify:

```bash
. .venv/bin/activate
npx wrangler@latest whoami
```

## Upload the adapter

Wrangler CLI (preferred):

```bash
npx wrangler@latest ai-finetune create \
  --account $CF_ACCOUNT_ID \
  --name awards-sql-lora-v1 \
  --model @cf/meta/llama-3.1-8b-instruct-fast \
  --description "Federal awards text-to-SQL LoRA, trained on synthetic+seed dataset" \
  out/llama31-8b-awards-sql
```

You'll get back a finetune ID — note it. (Format: `00000000-0000-0000-0000-000000000000`.)

If wrangler errors with "ai-finetune not found", upgrade wrangler or use the
HTTP API directly:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/finetunes/" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F 'name=awards-sql-lora-v1' \
  -F 'description=Federal awards text-to-SQL LoRA' \
  -F 'model=@cf/meta/llama-3.1-8b-instruct-fast' \
  -F 'adapter_config=@out/llama31-8b-awards-sql/adapter_config.json' \
  -F 'adapter_model=@out/llama31-8b-awards-sql/adapter_model.safetensors'
```

## Use it from your worker

Patch `workers/api/src/index.ts` (or wherever `/ai/ask` lives):

```ts
const result = await c.env.AI.run(
  '@cf/meta/llama-3.1-8b-instruct-fast',
  {
    messages: [
      { role: 'system', content: SYSTEM_WITH_SCHEMA },
      { role: 'user',   content: question },
    ],
    max_tokens: 400,
    temperature: 0,
  },
  {
    // Reference your uploaded LoRA by finetune ID
    finetune: 'YOUR-FINETUNE-ID-HERE',
  },
);
```

## Sanity check

```bash
curl https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai/run/@cf/meta/llama-3.1-8b-instruct-fast \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a text-to-SQL model..."},
      {"role": "user",   "content": "How many awards do we have at CDC?"}
    ],
    "finetune": "YOUR-FINETUNE-ID-HERE"
  }'
```

Expect a single SQL line back, like:
```sql
SELECT COUNT(*) FROM award a JOIN organization o ON o.org_id = a.awarding_org_id WHERE o.canonical_name = 'Centers for Disease Control and Prevention';
```

## Versioning

When you generate more training data and retrain, upload a new finetune
(`-v2`, `-v3`) so you can A/B test against `-v1` instead of overwriting.
Don't forget: roll back is just changing the `finetune:` ID in the worker.
