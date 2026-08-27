import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export type Course = {
  id: string;
  title: string;
  completionDays: number;
};

export type Enrollment = {
  learnerId: string;
  courseId: string;
  enrolledAt: string;
  dueAt: string;
};

type Learner = {
  id: string;
  email: string;
  name: string;
  passwordDigest: string;
};

type Session = {
  learnerId: string;
  expiresAt: number;
};

export type LearningHome = {
  learner: { id: string; email: string; name: string };
  sessionId: string;
  course: { id: string; title: string; dueAt: string };
};

export type EducatorReport = {
  courseId: string;
  enrolledLearners: number;
  deadlinesDueWithinSevenDays: number;
};

export class LearningAccess {
  readonly #learnersByEmail = new Map<string, Learner>();
  readonly #signupEmailsByRequestId = new Map<string, string>();
  readonly #enrollments: Enrollment[] = [];
  readonly #sessions = new Map<string, Session>();
  readonly #course: Course;
  readonly #now: () => Date;

  constructor(course: Course, now: () => Date = () => new Date()) {
    this.#course = course;
    this.#now = now;
  }

  async signUp(input: {
    email: string;
    password: string;
    name: string;
    requestId: string;
  }): Promise<LearningHome> {
    const email = input.email.toLowerCase();
    const priorEmail = this.#signupEmailsByRequestId.get(input.requestId);
    if (priorEmail) {
      if (priorEmail !== email) throw new AccessDecisionError("REQUEST_ID_CONFLICT", 409);
      const priorLearner = this.#learnersByEmail.get(email);
      if (priorLearner) return this.#openLearningHome(priorLearner);
    }
    if (this.#learnersByEmail.has(email)) {
      throw new AccessDecisionError("EMAIL_ALREADY_REGISTERED", 409);
    }

    const learner: Learner = {
      id: `learner_${randomBytes(12).toString("hex")}`,
      email,
      name: input.name,
      passwordDigest: await hashPassword(input.password),
    };
    this.#learnersByEmail.set(email, learner);
    this.#signupEmailsByRequestId.set(input.requestId, email);

    const enrolledAt = this.#now();
    const dueAt = new Date(enrolledAt.getTime() + this.#course.completionDays * 86_400_000);
    this.#enrollments.push({
      learnerId: learner.id,
      courseId: this.#course.id,
      enrolledAt: enrolledAt.toISOString(),
      dueAt: dueAt.toISOString(),
    });

    return this.#openLearningHome(learner);
  }

  async logIn(input: { email: string; password: string }): Promise<LearningHome> {
    const learner = this.#learnersByEmail.get(input.email.toLowerCase());
    if (!learner || !(await verifyPassword(input.password, learner.passwordDigest))) {
      throw new AccessDecisionError("INVALID_CREDENTIALS", 401);
    }
    return this.#openLearningHome(learner);
  }

  readSession(sessionId: string): LearningHome {
    const session = this.#sessions.get(sessionId);
    if (!session || session.expiresAt <= this.#now().getTime()) {
      this.#sessions.delete(sessionId);
      throw new AccessDecisionError("SESSION_EXPIRED", 401);
    }
    const learner = [...this.#learnersByEmail.values()].find(({ id }) => id === session.learnerId);
    if (!learner) {
      throw new AccessDecisionError("SESSION_EXPIRED", 401);
    }
    return this.#learningHomeFor(learner, sessionId);
  }

  educatorReport(): EducatorReport {
    const sevenDaysFromNow = this.#now().getTime() + 7 * 86_400_000;
    const courseEnrollments = this.#enrollments.filter(({ courseId }) => courseId === this.#course.id);
    return {
      courseId: this.#course.id,
      enrolledLearners: courseEnrollments.length,
      deadlinesDueWithinSevenDays: courseEnrollments.filter(
        ({ dueAt }) => Date.parse(dueAt) <= sevenDaysFromNow,
      ).length,
    };
  }

  #openLearningHome(learner: Learner): LearningHome {
    const sessionId = randomBytes(32).toString("base64url");
    this.#sessions.set(sessionId, {
      learnerId: learner.id,
      expiresAt: this.#now().getTime() + 8 * 60 * 60 * 1000,
    });
    return this.#learningHomeFor(learner, sessionId);
  }

  #learningHomeFor(learner: Learner, sessionId: string): LearningHome {
    const enrollment = this.#enrollments.find(({ learnerId }) => learnerId === learner.id);
    if (!enrollment) {
      throw new AccessDecisionError("ENROLLMENT_REQUIRED", 403);
    }
    return {
      learner: { id: learner.id, email: learner.email, name: learner.name },
      sessionId,
      course: { id: this.#course.id, title: this.#course.title, dueAt: enrollment.dueAt },
    };
  }
}

export class AccessDecisionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, digest: string): Promise<boolean> {
  const [saltHex, expectedHex] = digest.split(":");
  if (!saltHex || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
