import type { Point } from '@graphloom/core';
import type { LayoutGraph } from './contract.js';

/** Starts a run for `engineId` inside the worker. */
export interface WorkerRunRequest {
  readonly kind: 'run';
  readonly runId: number;
  readonly engineId: string;
  readonly graph: LayoutGraph;
  readonly options: unknown;
}

/** Requests cooperative cancellation of an in-flight run. */
export interface WorkerCancelRequest {
  readonly kind: 'cancel';
  readonly runId: number;
}

/** Messages sent main-thread → worker. */
export type WorkerRequest = WorkerRunRequest | WorkerCancelRequest;

/** A run reported progress. */
export interface WorkerProgressResponse {
  readonly kind: 'progress';
  readonly runId: number;
  readonly ratio: number;
}

/** A run streamed interim positions for a live-preview UI. */
export interface WorkerPreviewResponse {
  readonly kind: 'preview';
  readonly runId: number;
  readonly positions: ReadonlyMap<string, Point>;
}

/** A run finished successfully. */
export interface WorkerResultResponse {
  readonly kind: 'result';
  readonly runId: number;
  readonly positions: ReadonlyMap<string, Point>;
}

/** A run failed (unknown engine id, or the engine's `compute` threw). */
export interface WorkerErrorResponse {
  readonly kind: 'error';
  readonly runId: number;
  readonly message: string;
}

/** Messages sent worker → main-thread. */
export type WorkerResponse =
  | WorkerProgressResponse
  | WorkerPreviewResponse
  | WorkerResultResponse
  | WorkerErrorResponse;
