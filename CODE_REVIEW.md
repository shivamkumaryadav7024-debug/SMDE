# Code Review: Extract Endpoint PR
**Reviewer:** Senior Backend Engineer  
**Status:** ❌ **Request Changes**  
**Complexity:** High-risk, foundational component

---

## Executive Summary

This PR is **not production-ready**. It contains critical issues that would cause data loss, security breaches, and operational chaos in production. The core logic is correct (yes, you need to call the LLM and return JSON), but the execution violates multiple safety principles we enforce on this team:

1. **Hardcoded credentials exposed in source code**
2. **No error recovery strategy for the highest-risk component** (the LLM)
3. **Global mutable state used for persistence** (extractions in memory)
4. **No timeout protection** on external API calls
5. **Missing deduplication logic** (files uploaded twice would trigger two LLM calls)
6. **Files saved to disk with sensitive PII, no cleanup**
7. **Broad, unspecific prompt** that won't reliably extract structured data

**Why this matters:** This endpoint is the heart of the system. If it fails silently, if it exposes credentials, or if it loses data, everything downstream breaks. This is not a place for shortcuts.

**What's good:** You understand the happy path. You know how to send a file to Claude and parse the response. You tested it locally. That's a solid foundation. Now we're going to harden it for production.

---

## Detailed Comments

### 🔴 **Line 5: Hardcoded API Key**

```typescript
const client = new Anthropic({ apiKey: 'sk-ant-REDACTED' });
```

**Problem:**
- Even though you redacted it for review, hardcoding credentials in source is a **never-acceptable** pattern.
- This code will be committed to Git history (permanent record).
- If you ever use the real key, AWS scanning tools, GitHub security scans, and code reviewers will all flag this as a breach.
- Our deployment pipeline has automatic secret scanning. This PR would be rejected.

**Fix:**
```typescript
import { config } from '../config.js';

const llmProvider = getLLMProvider(config.LLM_PROVIDER, config.LLM_API_KEY, config.LLM_MODEL);
```

**Teaching moment:** Credentials are not code; they are runtime configuration. They belong in environment variables, validated at startup, never committed. This is not a style preference—it's a security requirement. Every company you work at enforces this. Internalize it now.

---

### 🔴 **Line 29–35: No Error Recovery on JSON Parse Failure**

```typescript
const result = JSON.parse(response.content[0].text);
// ...
global.extractions.push(result);
res.json(result);
```

**Problems:**
1. **Silent JSON failures:** If Claude returns wrapped-in-markdown or partial JSON, `JSON.parse()` throws immediately and you catch it generically (line 47). The raw response is lost.
2. **"Just throw and 500" is not a strategy:** You don't know if the error is:
   - Transient (network glitch) → **retryable**
   - Permanent (Claude's API broke, bad prompt) → **not retryable**
   - Our bug (malformed request) → **debug required**
3. **The user's document is lost:** They uploaded a valid file. The LLM returned a response. You crashed without storing anything. No audit trail. No way to debug later.

**Expected behavior per spec:**
> Store the raw response regardless. Never discard — even on total failure, store a record with status: FAILED and the raw LLM response.

**Fix:**
```typescript
import { extractJSON, repairJSON } from '../llm/json-repair.js';

let parsed;
const raw = response.content[0].text;

try {
  const jsonString = extractJSON(raw);  // Find { ... } in raw text
  if (!jsonString) throw new Error('No JSON found in response');
  parsed = JSON.parse(jsonString);
} catch (parseErr) {
  // Retry with a repair prompt
  console.log('[extract] First JSON parse failed, attempting repair...');
  try {
    const repaired = await llmProvider.generateText(
      `The following is a broken JSON response. Return ONLY valid JSON:\n${raw}`
    );
    const repairedJson = extractJSON(repaired);
    parsed = JSON.parse(repairedJson);
  } catch (repairErr) {
    // Even repair failed; store as FAILED
    await db.insert(extractions).values({
      sessionId,
      fileName,
      fileHash,
      status: 'FAILED',
      rawLlmResponse: raw,
      errorCode: 'LLM_JSON_PARSE_FAIL',
    });
    throw new AppError('LLM_JSON_PARSE_FAIL', 'Could not parse or repair LLM response.');
  }
}
```

**Why this matters:** This is the hard part of the assignment. You will get JSON failures in production. Your response to that failure is what separates a junior engineer from a senior one. "If it breaks, 500 error" is junior. "If it breaks, store the evidence, try to repair, and only fail if repair fails" is senior. This is your teaching moment.

---

### 🔴 **Line 39: Global Mutable State for Data Persistence**

```typescript
global.extractions = global.extractions || [];
global.extractions.push(result);
```

**Problems:**
1. **Data loss on restart:** Your server crashes. All extractions in memory vanish. Customers lose records.
2. **Not a database:** If you run two Node processes (for horizontal scaling), each has its own `global.extractions` array. They never sync. Requests to process A see different data than requests to process B.
3. **Memory leak:** The array grows unbounded. After 100K documents, your server uses 10GB+ RAM.
4. **Impossible to debug:** Where did my extraction go? Is it in memory? In the database? In a queue? You won't know.

**Fix:**
Persist to the database immediately:

```typescript
const extractionRecord = await db.insert(extractions).values({
  id: randomUUID(),
  sessionId,
  fileName,
  fileHash,
  documentType: parsed.detection?.documentType || null,
  holderName: parsed.holder?.fullName || null,
  fields: parsed.fields,
  validity: parsed.validity,
  // ... other fields
  status: 'COMPLETE',
  createdAt: new Date(),
}).returning();

return reply.json(extractionRecord);
```

**Why this matters:** If you persist to the database, restarting the service is safe. Scaling to 10 machines is possible. Your Manning Agents can audit what was extracted. This is foundational infrastructure thinking.

---

### 🟡 **Lines 22–24: Files Saved to Disk Permanently**

```typescript
// Save file to disk permanently for reference
const savedPath = path.join('./uploads', file.originalname);
fs.copyFileSync(file.path, savedPath);
```

**Problems:**
1. **Disk fills up over time:** Each document is saved. After 10K documents × 2MB average, you've used 20GB.
2. **Sensitive PII on disk indefinitely:** Passports, medical records, bank statements — all sitting on the server filesystem with no cleanup.
3. **No access control:** Anyone with SSH can read `/uploads/`. Compliance risk.
4. **Original filename collision:** If two users upload `passport.pdf`, the second overwrites the first.

**Improvement:**
The spec says "save files so we don't lose them." That means persist them somewhere, with governance:

```typescript
// Option 1: Store in database as BLOB (fine for MVP, not for scale)
const fileData = await data.toBuffer();
const storedFile = await db.insert(extractionFiles).values({
  extractionId,
  fileName: file.filename,
  mimetype: file.mimetype,
  data: fileData,  // bytea column
  createdAt: new Date(),
});

// Option 2: Store in S3 with automatic cleanup (better)
const s3Key = `uploads/${sessionId}/${randomUUID()}-${file.filename}`;
await s3.putObject({
  Bucket: config.S3_BUCKET,
  Key: s3Key,
  Body: fileData,
  Metadata: { 'original-filename': file.filename },
}).promise();
await db.insert(extractions).values({
  // ...
  s3Url: s3Key,
  // ...
});
```

**Current choice is acceptable for now,** but add cleanup:

```typescript
// Delete temp file after successful extraction
setTimeout(async () => {
  try {
    await unlink(savedPath);
  } catch (err) {
    console.warn(`Failed to cleanup ${savedPath}:`, err);
  }
}, 5000);  // 5 second grace period for debugging
```

---

### 🔴 **Line 44: No Timeout on LLM API Call**

```typescript
const response = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  // ... no timeout specified
});
```

**Problem:**
- Claude's API hangs for 10, 20, 30 seconds sometimes (rare, but it happens).
- Your HTTP request blocks indefinitely.
- Your server connection limit exhausts. New users can't connect.
- After ~90 seconds, the browser times out and the user refreshes, creating a duplicate request.

**Spec requirement:**
> Set a 30-second timeout on the LLM API call. On timeout, mark the job FAILED with retryable: true.

**Fix:**
```typescript
import { withTimeout } from '../utils/timeout.js';

const response = await withTimeout(
  client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [...],
  }),
  30_000  // 30 second timeout
);
```

Or use a library:
```typescript
import pTimeout from 'p-timeout';

const response = await pTimeout(
  client.messages.create(...),
  { milliseconds: 30_000 }
);
```

---

### 🟡 **Line 20: Wrong Model**

```typescript
model: 'claude-opus-4-6',
```

**Problem:**
- Claude Opus is the largest, slowest, most expensive model.
- For structured document extraction (not open-ended reasoning), you want Claude Haiku or Sonnet.
- Opus costs ~5x more per token and is 2x slower.

**Fix:**
```typescript
const client = new Anthropic({ apiKey: config.LLM_API_KEY });
const model = config.LLM_MODEL || 'claude-haiku-4-5-20251001';  // Let env override

const response = await client.messages.create({
  model,
  max_tokens: 4096,
  messages: [...]
});
```

**Why this matters:** Your coworkers will run this locally and watch the clock. "Why is extraction taking 15 seconds when it should take 3?" You'll find out: Opus. Cost matters too. At scale, model choice is the difference between $5K/month and $25K/month.

---

### 🟡 **Line 19: Prompt is Too Vague**

```typescript
text: 'Extract all information from this maritime document and return as JSON.',
```

**Problems:**
1. **"All information" is undefined.** What if the document has 1000 fields? Claude will return 1000 fields. You can't validate or store them all.
2. **No structure specified.** Claude might return `{ name: "...", data: {...} }` or `{ document: { holder: {...} } }`. Inconsistent.
3. **No error cases covered.** What if it's not a maritime document? What if it's a napkin scribble? What if there's no data to extract?
4. **No compliance context.** You want fields that matter for hiring decisions (expiry dates, medical flags, roles). A vague prompt won't reliably extract those.

**Fix:** Use the assignment's prompt, which is highly structured:

```typescript
const EXTRACTION_PROMPT = `
You are an expert maritime document analyst...
[Full prompt from assignment]
`;
```

---

### 🟡 **Line 11: Missing Rate Limiting**

Not in your code, but the spec requires:
> Rate Limiting: 10 requests per minute per IP.

Your endpoint needs:
```typescript
router.post('/extract', {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
}, async (request, reply) => {
  // ...
});
```

Use Fastify's rate-limit plugin (already in the team's setup).

---

### 🔴 **Line 46: Overly Broad Error Handler**

```typescript
} catch (error) {
  console.log('Error:', error);
  res.status(500).json({ error: 'Something went wrong' });
}
```

**Problems:**
1. **No error code.** The client gets "Something went wrong" — no hint if it's a timeout, bad file, auth failure, or server crash.
2. **No distinction between client fault and server fault.** Rate limit exceeded (429) looks the same as database down (500).
3. **No structured error shape.** The spec defines exactly what error responses should look like; you're ignoring it.

**Fix:**
```typescript
// Use structured error shape per spec
interface ErrorResponse {
  error: ErrorCode;
  message: string;
  extractionId?: string;
  retryAfterMs?: number;
}

app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  
  console.error('[extract] Unexpected error:', error);
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
});
```

---

### 🟢 **What You Got Right**

1. **You read the file from multipart correctly.** Base64 encoding is correct.
2. **You called the LLM provider correctly** (setting image data and text prompt).
3. **You parsed the JSON response.** This is the happy path.
4. **You tested locally** with a real PEME document. Good discipline.
5. **You used TypeScript** (implicitly, from context). This is essential.

---

## Summary of Required Changes

| Issue | Severity | Effort | Impact |
|-------|----------|--------|--------|
| Remove hardcoded key | 🔴 Critical | 5 min | Security breach if committed |
| Add JSON repair + error recovery | 🔴 Critical | 2 hours | Data loss without this |
| Remove global state; use DB | 🔴 Critical | 1 hour | Data loss on restart |
| Add LLM timeout | 🔴 Critical | 30 min | Server hangs under latency |
| Use correct model (Haiku not Opus) | 🟡 Important | 5 min | 5x cost overrun |
| Use assignment prompt, not vague one | 🟡 Important | 30 min | Unreliable extractions |
| Add rate limiting config | 🟡 Important | 15 min | Per spec |
| Use structured error responses | 🟡 Important | 1 hour | Hard to debug client-side |
| Add file cleanup or S3 storage | 🟡 Important | 1 hour | Disk fills up |

**Total effort to production-ready:** ~8 hours

---

## What's Next

1. **Don't rewrite from scratch.** Your logic is 80% there. Keep the structure, fix the issues above.
2. **Test JSON repair.** Write a unit test for the `extractJSON` function with markdown fences, preamble, and trailing text.
3. **Test error cases:** What happens if the file is corrupt? If Claude times out? If the API key is wrong?
4. **Read the full spec again.** I know it's long, but you'll catch details like "X-Deduplicated header" and "pollUrl in async response" that make the difference between working and complete.
5. **Review the team's existing patterns.** Look at how we handle errors in `sessionService` and `validationService`. Consistency matters.

---

## A Note on Growth

You're two steps away from a strong backend engineer:

**Step 1 (you are here):** Write code that works when things go well.  
**Step 2 (next):** Write code that fails gracefully and tells you why.  
**Step 3 (senior level):** Write code that recovers automatically, monitors itself, and prevents the same failure twice.

This PR is solid Step 1 work. The gap is between Step 1 and Step 2. The difference is asking yourself at every boundary (file upload, API call, database write):

- What could go wrong here?
- How would I know if it did?
- What's my recovery strategy?
- Can the user retry safely?

Ask these questions on your next PR and you'll ship better systems. I'm here to help.

**Well done on getting this to working code.** Now let's harden it.
