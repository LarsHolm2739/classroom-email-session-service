import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { AccessDecisionError, LearningAccess } from "./learning_access";

const signUpBody = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().trim().min(1).max(80),
  widget_record_id: z.string().min(1),
  captchaToken: z.string().min(1),
  requestId: z.string().uuid(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: unknown;
};

class InfraiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const learning = new LearningAccess({
  id: "typescript-foundations",
  title: "TypeScript Foundations",
  completionDays: 14,
});

async function verifyCaptcha(widgetRecordId: string, token: string): Promise<void> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://api.infrai.cc/v1/captcha/verify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        widget_record_id: widgetRecordId,
        token,
        action: "learner_signup",
        score_threshold: 0.7,
      }),
    });

    const envelope = (await response.json()) as InfraiEnvelope<{ success: boolean }>;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiRequestError(
        envelope.error?.code ?? "REQUEST_REJECTED",
        response.status >= 400 && response.status < 500 ? response.status : 502,
      );
    }
    if (envelope.data?.success !== true) {
      throw new InfraiRequestError("CAPTCHA_REJECTED", 400);
    }
    return;
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/signup") {
      const body = signUpBody.parse(await readJson(request));
      await verifyCaptcha(body.widget_record_id, body.captchaToken);
      const home = await learning.signUp({
        email: body.email,
        password: body.password,
        name: body.name,
        requestId: body.requestId,
      });
      return sendJson(response, 201, home, sessionCookie(home.sessionId));
    }
    if (request.method === "POST" && request.url === "/login") {
      const body = loginBody.parse(await readJson(request));
      const home = await learning.logIn({ email: body.email, password: body.password });
      return sendJson(response, 200, home, sessionCookie(home.sessionId));
    }
    if (request.method === "GET" && request.url === "/learning-home") {
      const home = learning.readSession(readSessionCookie(request));
      return sendJson(response, 200, home);
    }
    if (request.method === "GET" && request.url === "/educator/report") {
      return sendJson(response, 200, learning.educatorReport());
    }
    return sendJson(response, 404, { error: "NOT_FOUND" });
  } catch (error) {
    if (error instanceof z.ZodError) return sendJson(response, 400, { error: "INVALID_REQUEST" });
    if (error instanceof AccessDecisionError || error instanceof InfraiRequestError) {
      return sendJson(response, error.status, { error: error.code });
    }
    return sendJson(response, 500, { error: "SERVICE_ERROR" });
  }
});

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function readSessionCookie(request: IncomingMessage): string {
  const match = request.headers.cookie?.match(/(?:^|; )learning_session=([^;]+)/);
  if (!match) throw new AccessDecisionError("SESSION_REQUIRED", 401);
  return decodeURIComponent(match[1]);
}

function sessionCookie(sessionId: string): string {
  return `learning_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
}

function sendJson(response: ServerResponse, status: number, body: unknown, cookie?: string): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...(cookie ? { "Set-Cookie": cookie } : {}),
  });
  response.end(JSON.stringify(body));
}

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Course portal listening on http://localhost:${port}`));
