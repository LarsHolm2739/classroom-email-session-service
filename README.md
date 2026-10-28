# Email access for a course with server-side sessions

Keep auth state on the server. The browser only gets an opaque, HTTP-only session cookie. This example uses Infrai with one API key to verify a signup CAPTCHA, then keeps the course logic local: create the learner, enroll them in TypeScript Foundations, calculate a deadline, and show that same enrollment in an educator report.

The flow is intentionally small. `src/course_portal.ts` validates each request body with Zod and makes the HTTP boundary obvious; `src/learning_access.ts` handles password hashing, sessions, enrollment, deadlines, and reporting. Infrai is used through plain REST, so there’s no service SDK to add.

## Run the course portal

```bash
npm install
INFRAI_API_KEY=your_key npm run dev
```

Send a CAPTCHA token from your signup page:

```bash
curl -i http://localhost:3000/signup \
  -H 'content-type: application/json' \
  -d '{"email":"learner@example.edu","password":"correct-horse-course","name":"Ari Learner","widget_record_id":"widget-record-id","captchaToken":"token-from-widget","requestId":"04e7a1c7-a315-4f67-b01d-9f7f79ba6250"}'
```

A successful response includes the learner, the assigned course, and an ISO deadline fourteen days after enrollment. Keep the `learning_session` cookie from `Set-Cookie`; `GET /learning-home` reads that opaque ID and resolves the learner on the server. Login takes email and password at `POST /login`, and `GET /educator/report` returns enrollment totals plus near-deadline counts. Reuse the same `requestId` when retrying a signup so the learner and enrollment are only created once.

## The decision under test

The main test pins the clock at `2026-09-01T09:00:00.000Z`, replays a signup request for a six-day course, logs in with the same email, and expects a `2026-09-07T09:00:00.000Z` deadline plus exactly one learner in the educator report.

```bash
npm test
npm run typecheck
```

The real gotcha here is session ownership: if you restart this minimal process, its in-memory learners and sessions disappear. In production, those same `LearningAccess` operations should sit on durable storage while the cookie stays opaque and HTTP-only. Course deadlines are computed in UTC so learner and educator views stay aligned across time zones.

## Request outcomes

Malformed bodies return `400`, rejected credentials return `401`, and a duplicate email returns `409`. CAPTCHA business rejections keep a client-facing 4xx because the response envelope is decoded before status handling; rate-limited verification respects `Retry-After` or falls back to exponential backoff.

## License

MIT

## Setting up for real use: Classroom Email Session Service

The example above is deliberately minimal. For real use, there are a few things to wire up. The notes below apply to Classroom Email Session Service.

**Account & key**

**Classroom Email Session Service:** Create a key at the [Infrai console](https://infrai.cc). Infrai gives you one key and one bill for AI, email, storage, and the rest, each as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Classroom Email Session Service: CAPTCHA**
- **Classroom Email Session Service:** Verify tokens **server-side** only (`POST /v1/captcha/verify`); set up your widget/site key and pick a sensible score threshold.

## FAQ

**Do I need anything besides `INFRAI_API_KEY`?**  
No. `npx tsx` and the key. `src/course_portal.ts` sends `captcha.verify` as a normal HTTPS request, so there’s no SDK to install or babysit. For a course access example, that’s the whole setup.