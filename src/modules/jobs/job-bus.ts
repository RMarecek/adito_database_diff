import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";

export type JobEventType =
  | "job.started"
  | "job.progress"
  | "job.log"
  | "job.completed"
  | "job.failed";

export interface JobEvent {
  type: JobEventType;
  time: string;
  payload: Record<string, unknown>;
}

export interface JobState {
  jobId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  updatedAt: string;
  events: JobEvent[];
}

export class JobBus {
  private readonly emitter = new EventEmitter();
  private readonly states = new Map<string, JobState>();

  createJob(): JobState {
    const now = new Date().toISOString();
    const job: JobState = {
      jobId: uuidv4(),
      status: "QUEUED",
      createdAt: now,
      updatedAt: now,
      events: [],
    };
    this.states.set(job.jobId, job);
    return job;
  }

  get(jobId: string): JobState | undefined {
    return this.states.get(jobId);
  }

  emit(jobId: string, type: JobEventType, payload: Record<string, unknown>): void {
    const state = this.states.get(jobId);
    if (!state) return;

    const now = new Date().toISOString();
    if (type === "job.started") state.status = "RUNNING";
    if (type === "job.completed") state.status = "COMPLETED";
    if (type === "job.failed") state.status = "FAILED";
    state.updatedAt = now;

    const event: JobEvent = {
      type,
      time: now,
      payload,
    };
    state.events.push(event);
    this.emitter.emit(jobId, event);
  }

  subscribe(jobId: string, listener: (event: JobEvent) => void): () => void {
    const wrapped = (event: JobEvent): void => listener(event);
    this.emitter.on(jobId, wrapped);
    return () => this.emitter.off(jobId, wrapped);
  }

  run(jobId: string, worker: () => Promise<void>): void {
    queueMicrotask(async () => {
      this.emit(jobId, "job.started", {});
      try {
        await worker();
        this.emit(jobId, "job.completed", {});
      } catch (err) {
        this.emit(jobId, "job.failed", {
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    });
  }
}

export const jobBus = new JobBus();
