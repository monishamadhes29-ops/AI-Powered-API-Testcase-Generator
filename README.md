# AI API Test Case Generator

Upload a Swagger document (file or URL) and get back a validated, auto-corrected specification plus a full suite of Groq-generated API test cases — exportable as JSON, Excel, a Postman collection, or the corrected spec itself.

1. [🎯 What is this?](#-what-is-this)
2. [✨ Key Features](#-key-features)
3. [🏗️ Architecture](#️-architecture)
4. [🔄 How it works](#-how-it-works)
5. [🤖 Where GenAI is used](#-where-genai-is-used)
6. [🧪 Test Case Generation](#-test-case-generation)
7. [📊 Example](#-example)
8. [📤 Export Options](#-export-options)
9. [🛠️ Tech Stack](#️-tech-stack)
10. [🚀 Getting Started](#-getting-started)
11. [📁 Project Structure](#-project-structure)
12. [🔐 Security / LLM Safety](#-security--llm-safety)
13. [🔮 Future Enhancements](#-future-enhancements)

---

## 🎯 What is this?

A web app that turns a Swagger document into ready-to-use API test cases, end to end:

**Upload (file or URL) → Validate → Auto-Correct → Generate Test Cases → Export**

Every path/operation in the spec is turned into concrete, executable test scenarios — positive, negative, boundary, auth, validation, and error-handling — without requiring a database or any manual test authoring. Validation and auto-correction work standalone (correction only calls the LLM as a best-effort repair step, with a deterministic fallback); **test case generation requires a configured Groq API key** — there is no offline/deterministic generation path.

---

## ✨ Key Features

- **Upload & parse** Swagger specs in YAML or JSON — as a file upload, or by pasting a URL (with automatic discovery if the URL points to a Swagger UI/ReDoc page instead of the raw spec)
- **Validation** via `@apidevtools/swagger-parser` plus custom checks (e.g. missing `operationId`)
- **Auto-correction** — deterministic fixes first (missing `info.title`/`version`, missing `responses`/`description`), then an optional Groq LLM repair pass for anything still invalid; correction degrades gracefully to deterministic-only if Groq isn't configured or fails
- **LLM-driven test case generation** — Groq reads the (chunked) spec and produces test cases per category; there is no deterministic fallback here, so a configured `GROQ_API_KEY`/`GROQ_MODEL` is required to generate any test cases
- **7 test categories** — positive, negative, boundary, authentication, authorization, validation, error-handling
- **Resilient chunked generation** — large specs are split into small path batches per Groq call; if some batches fail after retries, the rest are still returned and the response is flagged `partial`
- **Dedup, cap & prioritize** — merged results are deduplicated, capped at `MAX_TEST_CASES` (round-robin per category, priority-sorted), and renumbered as `TC-API-001`, `TC-API-002`, …
- **Multi-format export** — JSON, styled Excel (`.xlsx`), Postman collection (with injected `pm.test` scripts), and the corrected Swagger file
- **Stateless & session-scoped** — no database; each upload gets an in-memory session (UUID) that expires automatically after `SESSION_TTL_MINUTES`

---

## 🏗️ Architecture

```
          Swagger Spec (file upload, or fetched from a URL)
                             │
                             ▼
              Schema Parser & Validator
              (swagger-parser + Zod schemas)
                             │
                             ▼
        Auto-Correction (deterministic  ⟶  optional Groq repair)
                             │
                             ▼
              Endpoint & Schema Extraction
                             │
                             ▼
          Spec chunked by path (GROQ_MAX_PATHS_PER_CHUNK)
                             │
                             ▼
             Groq LLM — Test Case Generation
        (one call per chunk, JSON-schema-validated,
             partial results tolerated per chunk)
                             │
                 merge chunks · dedupe · cap · renumber
                             ▼
     ┌──────────┬──────────┬──────────┬──────────────┬──────────────────┐
     ▼          ▼          ▼          ▼              ▼                  ▼
 Positive   Negative   Boundary   Auth(N/Z)      Validation       Error-Handling
     │          │          │          │              │                  │
     └──────────┴──────────┴──────────┴──────────────┴──────────────────┘
                             │
                             ▼
          JSON · Excel · Postman Collection · Corrected Swagger
```

**Layers:**
- **Frontend** — React SPA (Vite dev server, port `5173`) driving a 3-step wizard UI
- **Backend** — Express + TypeScript API (port `4000`), stateless request handlers backed by an in-memory session store
- **LLM** — Groq's `chat/completions` endpoint, called from exactly one backend module (`groq.service.ts`); required for test case generation, optional (best-effort) for correction

---

## 🔄 How it works

1. **Upload** — user drops a `.yaml`/`.yml`/`.json` file, or pastes a URL (SSRF-guarded fetch, with auto-discovery if it's a Swagger UI/ReDoc page) → backend parses it and creates a session
2. **Validate** — the spec is checked with `swagger-parser`; errors/warnings are shown in the UI
3. **Correct** *(if invalid)* — deterministic fixes run first; if the spec is still invalid, Groq is asked to repair it (only if configured) — this step degrades gracefully without Groq
4. **Confirm** — generation is gated behind an explicitly-valid specification
5. **Generate** — the spec is split into path-sized chunks and sent to Groq for the requested categories; each chunk's response is schema-validated and merged, then the combined results are deduplicated, capped, and renumbered. This step **requires Groq to be configured** and returns a `503` otherwise; if some chunks fail after retries, the rest are still returned, flagged `partial`
6. **Review** — the UI shows a searchable, filterable table with per-case detail (preconditions, steps, request data, expected result)
7. **Export** — download as JSON, Excel, Postman collection, or the corrected spec
8. **Clear** — the session and all in-memory state can be discarded at any point

Every step after upload is keyed by an in-memory `sessionId`; nothing is written to disk or a database.

---

## 🤖 Where GenAI is used

Groq is called from exactly **one** backend module (`groq.service.ts`), by exactly two callers — with different fallback behavior:

| Caller | Purpose | Prompt | If Groq is unavailable or fails |
|---|---|---|---|
| `correction.service.ts` | Repairs a Swagger document when deterministic fixes aren't enough | `CORRECTION_SYSTEM_PROMPT` | Falls back to the deterministic-only correction result; the request still succeeds |
| `testcase.service.ts` | Generates all test cases from the (chunked) spec | `TEST_CASE_SYSTEM_PROMPT` | The request fails (`503 GROQ_NOT_CONFIGURED`, or the underlying Groq error) — **there is no deterministic fallback for generation** |

Shared safety contract for both callers:
- **Gated** — a caller is skipped/blocked entirely unless `GROQ_API_KEY` and `GROQ_MODEL` are set
- **Structured output** — requests use `response_format: json_object` so the model can only reply with JSON
- **Schema-validated** — every Groq response is parsed against a Zod schema (`GroqCorrectionOutputSchema` / `ApiTestCaseSchema`, validated case-by-case) before it's trusted
- **Retried, then surfaced** — rate limits (`429`) and transient JSON-generation failures are retried with a capped backoff before giving up
- **Chunked for scale** — large specs are split into small path batches (`GROQ_MAX_PATHS_PER_CHUNK`) to stay under Groq's per-minute token limits; one chunk exhausting its retries doesn't cancel the others — partial results are returned instead of an all-or-nothing failure
- **Model-agnostic** — `GROQ_MODEL` is a plain env var, so any Groq-hosted chat-completions model can be swapped in without code changes

---

## 🧪 Test Case Generation

The generation engine (`testcase.service.ts`) requires Groq to be configured — it has no deterministic mode. It trims non-essential descriptive fields from the spec to save tokens, splits the `paths` object into batches of `GROQ_MAX_PATHS_PER_CHUNK`, and sends each batch to Groq along with the requested categories. Each chunk's response is validated case-by-case against `ApiTestCaseSchema`; a single malformed case is dropped rather than discarding the whole chunk.

**Categories generated:**

| Category | What it covers |
|---|---|
| `positive` | Valid request → expected success response |
| `negative` | Invalid/malformed input → expected client error |
| `boundary` | Min/max, empty, and edge-of-range values from schema constraints |
| `authentication` | Missing/invalid credentials against secured operations |
| `authorization` | Insufficient-permission scenarios for secured operations |
| `validation` | Schema constraint violations (type, required fields, format) |
| `error-handling` | Server-side / unexpected-condition scenarios |

**Pipeline:** chunk `paths` by `GROQ_MAX_PATHS_PER_CHUNK` → `groqCases()` per chunk (schema-validated, invalid individual cases dropped) → merge all chunks → `deduplicate()` → `limitTestCases(MAX_TEST_CASES)` (round-robin cap, priority-sorted within category) → `renumber()` → `summarizeTestCases()`. If every chunk fails, the whole request fails; if only some do, the response returns the rest with `partial: true`.

Each generated case has this shape (`ApiTestCase`):

```ts
{
  testCaseId, operationId, endpoint, method,
  category, title, priority,             // "High" | "Medium" | "Low"
  preconditions[], headers, pathParameters, queryParameters, requestBody,
  steps[], expectedStatusCode, expectedResult, sourceReferences[]
}
```

---

## 📊 Example

**Example Input** — a fragment of a Swagger spec (`examples/petstore.yaml`):

```yaml
paths:
  /pets:
    post:
      operationId: createPet
      security:
        - bearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/NewPet"
      responses:
        "201": { description: Pet created successfully }
        "400": { description: Invalid request }
        "401": { description: Authentication required }
```

**Example Output** — one Groq-generated test case for that operation:

```json
{
  "testCaseId": "TC-API-004",
  "operationId": "createPet",
  "endpoint": "/pets",
  "method": "POST",
  "category": "authentication",
  "title": "createPet fails without a valid bearer token",
  "priority": "High",
  "preconditions": ["No Authorization header is supplied"],
  "headers": {},
  "pathParameters": {},
  "queryParameters": {},
  "requestBody": { "name": "Fluffy", "tag": "cat" },
  "steps": [
    "Send POST /pets without an Authorization header",
    "Include a valid request body matching the NewPet schema"
  ],
  "expectedStatusCode": 401,
  "expectedResult": "Request is rejected with 401 Authentication required",
  "sourceReferences": ["paths./pets.post.security", "paths./pets.post.responses.401"]
}
```

---

## 📤 Export Options

| Format | Endpoint | Notes |
|---|---|---|
| **JSON** | `GET /export/json` | Raw array of generated test cases |
| **Excel** | `GET /export/excel` | Styled `.xlsx` via `exceljs` — frozen header, autofilter, formula-injection-safe cells |
| **Postman Collection** | `POST /postman/generate` → `GET /export/postman` | Requests grouped by tag, with optional injected `pm.test` assertions (status < 500, response time) |
| **Corrected Swagger** | `GET /export/swagger` | The auto-corrected spec, serialized back to YAML or JSON |

---

## 🛠️ Tech Stack

**Frontend**
- React 19 + TypeScript
- Vite (dev server + build), proxying `/api` → the backend in development

**Backend**
- Express 5 + TypeScript (`tsx` for dev, `tsc` for build)
- Zod — request/response and LLM-output validation
- `@apidevtools/swagger-parser` — spec validation
- `multer` — in-memory file upload handling
- `helmet`, `cors`, `express-rate-limit` — baseline API hardening
- `exceljs` — Excel export
- `openapi-to-postmanv2` — Postman collection generation
- `pino` / `pino-http` — structured logging
- `vitest` — test runner

**GenAI**
- Groq API — `chat/completions` endpoint, model configurable via `GROQ_MODEL`

**Persistence**
- None — in-memory session store with TTL-based expiry; no database

---

## 🚀 Getting Started

```bash
# Backend
cd backend
npm install
# create backend/.env — see variables below
npm run dev              # tsx watch, listens on :4000

# Frontend
cd frontend
npm install
npm run dev               # Vite dev server on :5173, proxies /api → :4000
```

Open `http://localhost:5173` and step through **Upload → Validate/Correct → Generate → Export**.

**`backend/.env` variables:**

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | yes | Backend listen port |
| `CORS_ORIGIN` | yes | Allowed frontend origin |
| `MAX_FILE_SIZE_MB` | yes | Upload size limit (applies to both file uploads and URL fetches) |
| `SESSION_TTL_MINUTES` | yes | In-memory session lifetime |
| `MAX_TEST_CASES` | yes | Cap on generated test cases per session |
| `URL_FETCH_TIMEOUT_MS` | optional | Timeout when fetching a spec from a user-supplied URL |
| `GROQ_API_KEY` | **required to generate test cases** (optional for correction) | Groq API key |
| `GROQ_MODEL` | **required to generate test cases** (optional for correction) | Groq model id — must be set alongside the key |
| `GROQ_TIMEOUT_MS` | optional | Per-request Groq timeout |
| `GROQ_MAX_COMPLETION_TOKENS` | optional | Output token cap for Groq responses |
| `GROQ_REASONING_EFFORT` | optional | Only for reasoning-capable models |
| `GROQ_MAX_PATHS_PER_CHUNK` | optional | Paths per Groq generation chunk — lower this if generation on large specs hits Groq's rate limit |

> Without `GROQ_API_KEY`/`GROQ_MODEL` set, validation and correction still work, but **test case generation will fail** (`503 GROQ_NOT_CONFIGURED`). Never commit a real `GROQ_API_KEY` — keep `.env` out of version control.

---

## 📁 Project Structure

```
frontend/
  src/
    App.tsx                 # top-level workflow state machine
    components/
      UploadPanel.tsx        # step 1 — file upload
      ValidationPanel.tsx    # step 2 — validation report + correction
      TestcasePanel.tsx      # step 3 — results table + export actions
      StatusPill.tsx         # shared status badge
    services/api.ts          # the only module that talks to the backend
    types/index.ts           # TS mirrors of backend response shapes

backend/
  src/
    server.ts / app.ts       # process entry + Express app/middleware pipeline
    routes/index.ts          # full REST API surface
    controllers/             # swagger / testcase / postman / export / session
    services/
      swagger.service.ts     # parse / validate / serialize specs; SSRF-guarded URL fetch
      correction.service.ts  # deterministic + Groq-assisted correction
      testcase.service.ts    # Groq-only, chunked test case generation
      groq.service.ts        # the only module that calls the Groq API
      prompts.ts              # system prompts sent to Groq
      postman.service.ts     # spec → Postman collection
      export.service.ts      # Excel export
      summary.service.ts     # session summary aggregation
    store/session.store.ts   # in-memory session map (TTL eviction)
    schemas/                 # Zod schemas for API input + LLM output
    middleware/               # upload, request-id, error handling

examples/
  petstore.yaml              # sample Swagger spec for manual testing
```

---

## 🔐 Security / LLM Safety

- **Hardened HTTP surface** — `helmet` security headers, `cors` restricted to `CORS_ORIGIN`, `express-rate-limit` (120 req/min), 2 MB JSON body limit
- **Upload validation** — `multer` restricts file type (`.yaml`/`.yml`/`.json`) and size (`MAX_FILE_SIZE_MB`), in-memory only (never written to disk)
- **SSRF-guarded URL upload** — before fetching a user-supplied spec URL, the backend resolves the hostname and blocks loopback, private, and link-local IP ranges (both IPv4 and IPv6), restricts to `http`/`https`, enforces `URL_FETCH_TIMEOUT_MS`, and caps the response at `MAX_FILE_SIZE_MB`; the same guard applies to every follow-up request (discovered spec links, well-known-path probing) — this is a pre-fetch DNS check, not a full DNS-rebinding-proof guard
- **Input validation** — every request body/param is validated with Zod before it reaches a service
- **LLM output is never trusted blindly** — both Groq response types are parsed against strict Zod schemas (`GroqCorrectionOutputSchema`, `ApiTestCaseSchema`); malformed or hallucinated output is rejected, not applied
- **Correction degrades gracefully; generation does not** — any Groq failure during correction (timeout, rate limit, invalid JSON, HTTP error) falls back to the deterministic-only result; the same failure during test case generation fails that request instead, since generation has no deterministic path
- **Excel injection protection** — exported cell values are sanitized (`safeCell()`) against formula-injection characters (`=`, `+`, `-`, `@`)
- **Secret hygiene** — logs redact `Authorization` headers and `GROQ_API_KEY`/`apiKey` fields
- **No persistence** — uploaded specs and generated test cases live only in memory for the session's TTL, then are purged

---

## 🔮 Future Enhancements

- A deterministic/offline fallback for test case generation, so the app doesn't hard-fail when Groq is unconfigured or down (correction already has this; generation currently doesn't)
- Pluggable multi-LLM support (Anthropic, local models, etc.) alongside Groq
- Optional persistent storage (spec/test case history across sessions)
- Generated test *code* export (e.g. Playwright, RestAssured, pytest) in addition to JSON/Excel/Postman
- Direct test execution against a live API with pass/fail reporting
- Spec-diffing to regenerate only test cases affected by an API change
- CI/CD integration (e.g. a GitHub Action that regenerates and runs tests on spec changes)
- Deeper security/fuzz-style negative test coverage
- User accounts and team-shared sessions
