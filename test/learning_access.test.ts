import assert from "node:assert/strict";
import test from "node:test";
import { LearningAccess } from "../src/learning_access";

test("signup enrolls the learner and exposes the deadline after login", async () => {
  const fixedNow = new Date("2026-09-01T09:00:00.000Z");
  const access = new LearningAccess(
    { id: "typescript-foundations", title: "TypeScript Foundations", completionDays: 6 },
    () => fixedNow,
  );

  const signup = {
    email: "learner@example.edu",
    password: "correct-horse-course",
    name: "Ari Learner",
    requestId: "04e7a1c7-a315-4f67-b01d-9f7f79ba6250",
  };
  await access.signUp(signup);
  await access.signUp(signup);
  const home = await access.logIn({
    email: "learner@example.edu",
    password: "correct-horse-course",
  });

  assert.equal(home.course.title, "TypeScript Foundations");
  assert.equal(home.course.dueAt, "2026-09-07T09:00:00.000Z");
  assert.deepEqual(access.educatorReport(), {
    courseId: "typescript-foundations",
    enrolledLearners: 1,
    deadlinesDueWithinSevenDays: 1,
  });
  assert.equal(access.readSession(home.sessionId).learner.email, "learner@example.edu");
});
