# Fakkakha AI — Competition Architecture

```text
                         ┌─────────────────────────┐
                         │      Student / Judge     │
                         └────────────┬────────────┘
                                      │
                           PWA / Capacitor client
                                      │
                              Supabase Auth token
                                      │
                                      ▼
                    ┌────────────────────────────────┐
                    │       Vercel Serverless API     │
                    │─────────────────────────────────│
                    │ Diagnose  │ Session │ Mistake  │
                    │ Image     │ Exam    │ Metrics  │
                    └──────────────┬───────────┬─────┘
                                   │           │
                         validated AI output  │ RLS-scoped data
                                   │           │
                                   ▼           ▼
                              ┌────────┐  ┌──────────┐
                              │ Gemini │  │ Supabase │
                              │  AI    │  │ Postgres │
                              └────────┘  └──────────┘
```

## Trust boundaries

- Provider API keys are server-side only.
- Student database rows are scoped through authenticated ownership policies.
- Exam answer keys never need to be sent to the browser.
- AI responses are schema-validated before state updates.
- Inputs are bounded before they can trigger expensive model calls.

## Failure strategy

- AI schema failure → retry once → safe fallback.
- Rate limit → reject without calling the model.
- Invalid auth → reject before database/AI work.
- AI/content report → persist report without breaking the student flow.
- Service worker → network-first for application code to reduce stale deployments.
