import { describe, expect, it } from "vitest";

import { InMemoryJobQueue } from "../../src/jobQueue.js";
import type { JobSummary } from "../../src/types.js";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushQueue(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushQueue();
    }
  }

  throw lastError;
}

function submitJob(
  queue: InMemoryJobQueue,
  request: {
    jobId: string;
    workspace: string;
    vivadoVersion?: string;
    resourceSlots?: number;
    resource_slots?: number;
  }
): JobSummary {
  return queue.submit({
    vivadoVersion: "2025.1",
    toolProfile: "vivado.batch",
    ...request
  } as Parameters<InMemoryJobQueue["submit"]>[0]);
}

describe("InMemoryJobQueue", () => {
  it("does not run more jobs than the global concurrency limit", async () => {
    const releases: Record<string, Deferred> = {
      "job-0": deferred(),
      "job-1": deferred(),
      "job-2": deferred()
    };
    const running: string[] = [];
    const queue = new InMemoryJobQueue({
      maxConcurrentJobs: 2,
      perVersionConcurrency: { "2025.1": 2 },
      runner: async (job) => {
        running.push(job.jobId);
        await releases[job.jobId].promise;
        return { exitCode: 0 };
      }
    });

    submitJob(queue, { jobId: "job-0", workspace: "/workspace/0" });
    submitJob(queue, { jobId: "job-1", workspace: "/workspace/1" });
    submitJob(queue, { jobId: "job-2", workspace: "/workspace/2" });

    await waitFor(() => expect(running).toEqual(["job-0", "job-1"]));

    releases["job-0"].resolve();
    await waitFor(() => expect(queue.get("job-0")?.state).toBe("succeeded"));
    await waitFor(() => expect(running).toEqual(["job-0", "job-1", "job-2"]));

    releases["job-1"].resolve();
    releases["job-2"].resolve();
    await waitFor(() => expect(queue.list().map((job) => job.state)).toEqual(["succeeded", "succeeded", "succeeded"]));
  });

  it("respects per-version execution slots independently of global capacity", async () => {
    const releases: Record<string, Deferred> = {
      "old-a": deferred(),
      "old-b": deferred(),
      current: deferred()
    };
    const running: string[] = [];
    const queue = new InMemoryJobQueue({
      maxConcurrentJobs: 3,
      perVersionConcurrency: { "2024.2": 1, "2025.1": 2 },
      runner: async (job) => {
        running.push(job.jobId);
        await releases[job.jobId].promise;
        return { exitCode: 0 };
      }
    });

    submitJob(queue, { jobId: "old-a", workspace: "/workspace/old-a", vivadoVersion: "2024.2" });
    submitJob(queue, { jobId: "old-b", workspace: "/workspace/old-b", vivadoVersion: "2024.2" });
    submitJob(queue, { jobId: "current", workspace: "/workspace/current", vivadoVersion: "2025.1" });

    await waitFor(() => expect(running).toEqual(["old-a", "current"]));

    releases["old-a"].resolve();
    await waitFor(() => expect(queue.get("old-a")?.state).toBe("succeeded"));
    await waitFor(() => expect(running).toEqual(["old-a", "current", "old-b"]));

    releases["old-b"].resolve();
    releases.current.resolve();
    await waitFor(() => expect(queue.list().every((job) => job.state === "succeeded")).toBe(true));
  });

  it("locks each workspace so only one job per workspace runs at a time", async () => {
    const releases: Record<string, Deferred> = {
      "shared-a": deferred(),
      "shared-b": deferred(),
      other: deferred()
    };
    const running: string[] = [];
    const queue = new InMemoryJobQueue({
      maxConcurrentJobs: 3,
      perVersionConcurrency: { "2025.1": 3 },
      runner: async (job) => {
        running.push(job.jobId);
        await releases[job.jobId].promise;
        return { exitCode: 0 };
      }
    });

    submitJob(queue, { jobId: "shared-a", workspace: "/workspace/shared" });
    submitJob(queue, { jobId: "shared-b", workspace: "/workspace/shared" });
    submitJob(queue, { jobId: "other", workspace: "/workspace/other" });

    await waitFor(() => expect(running).toEqual(["shared-a", "other"]));

    releases["shared-a"].resolve();
    await waitFor(() => expect(queue.get("shared-a")?.state).toBe("succeeded"));
    await waitFor(() => expect(running).toEqual(["shared-a", "other", "shared-b"]));

    releases["shared-b"].resolve();
    releases.other.resolve();
    await waitFor(() => expect(queue.list().every((job) => job.state === "succeeded")).toBe(true));
  });

  it("cancels a queued job without starting it", async () => {
    const release = deferred();
    const running: string[] = [];
    const queue = new InMemoryJobQueue({
      maxConcurrentJobs: 1,
      perVersionConcurrency: { "2025.1": 1 },
      runner: async (job) => {
        running.push(job.jobId);
        await release.promise;
        return { exitCode: 0 };
      }
    });

    submitJob(queue, { jobId: "first", workspace: "/workspace/first" });
    submitJob(queue, { jobId: "queued", workspace: "/workspace/queued" });

    await waitFor(() => expect(running).toEqual(["first"]));
    expect(queue.cancel("queued")).toBe(true);
    expect(queue.get("queued")?.state).toBe("cancelled");

    release.resolve();
    await waitFor(() => expect(queue.get("first")?.state).toBe("succeeded"));
    expect(running).toEqual(["first"]);
  });

  it("requires resource_slots across global and per-version capacity", async () => {
    const releases: Record<string, Deferred> = {
      wide: deferred(),
      "one-slot": deferred(),
      waits: deferred()
    };
    const running: string[] = [];
    const queue = new InMemoryJobQueue({
      maxConcurrentJobs: 3,
      perVersionConcurrency: { "2025.1": 3 },
      runner: async (job) => {
        running.push(job.jobId);
        await releases[job.jobId].promise;
        return { exitCode: 0 };
      }
    });

    submitJob(queue, { jobId: "wide", workspace: "/workspace/wide", resource_slots: 2 });
    submitJob(queue, { jobId: "one-slot", workspace: "/workspace/one-slot", resource_slots: 1 });
    submitJob(queue, { jobId: "waits", workspace: "/workspace/waits", resource_slots: 2 });

    await waitFor(() => expect(running).toEqual(["wide", "one-slot"]));

    releases["one-slot"].resolve();
    await waitFor(() => expect(queue.get("one-slot")?.state).toBe("succeeded"));
    await flushQueue();
    expect(running).toEqual(["wide", "one-slot"]);

    releases.wide.resolve();
    await waitFor(() => expect(queue.get("wide")?.state).toBe("succeeded"));
    await waitFor(() => expect(running).toEqual(["wide", "one-slot", "waits"]));

    releases.waits.resolve();
    await waitFor(() => expect(queue.get("waits")?.state).toBe("succeeded"));
  });
});
