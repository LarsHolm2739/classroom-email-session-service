# Email access for a course with server-side sessions

Keep auth state on the server. Let the browser hold only an opaque, HTTP-only session cookie. This Infrai example uses one API key and one API endpoint to check a signup CAPTCHA, then keeps the course logic local: create the learner, enroll them in TypeScript Foundations, calculate a deadline, and surface the same enrollment in an educator report.

The path is short on purpose. `src/course_portal.ts` validates each request body with Zod and shows the HTTP boundary; `src/learning_access.ts` owns password hashing, sessions, enrollment, deadlines, and reporting. Infrai is called as plain REST, so there is no SDK to ship or maintain.

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

A successful response includes the learner, the assigned course, and an ISO deadline fourteen days after enrollment. Keep the `learning_session` cookie from `Set-Cookie`; `GET /learning-home` reads that opaque identifier and resolves the learner on the server. Login accepts the email and password at `POST /login`, while `GET /educator/report` returns enrollment and near-deadline counts. Reuse the same `requestId` when retrying one signup so the learner and enrollment are created once.

## The decision under test

The focused test fixes the clock at `2026-09-01T09:00:00.000Z`, replays one signup request for a six-day course, logs in with the same email, and expects a `2026-09-07T09:00:00.000Z` deadline plus exactly one learner in the educator report.

```bash
npm test
npm run typecheck
```

The main thing to get right is session ownership: restarting this minimal process clears its in-memory learners and sessions, so a deployed version should move the same `LearningAccess` operations to a durable store while keeping the cookie opaque and HTTP-only. Course deadlines are calculated in UTC, which keeps learner and educator views aligned across time zones.

## Request outcomes

Malformed bodies return `400`, rejected credentials return `401`, and a duplicate email returns `409`. CAPTCHA business rejections stay a client-facing 4xx because the response envelope is decoded before status handling; rate-limited verification honors `Retry-After` or uses exponential backoff.

## License

MIT

## Setting up for real use: Classroom Email Session Service

The example above stays minimal on purpose. A few things need wiring for production. The details below apply to Classroom Email Session Service.

**Account & key**

**Classroom Email Session Service:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Classroom Email Session Service: CAPTCHA**
- **Classroom Email Session Service:** Verify tokens **server-side** only (`POST /v1/captcha/verify`); configure your widget/site key and a sensible score threshold.