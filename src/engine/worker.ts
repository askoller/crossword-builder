/// <reference lib="webworker" />
// Fill engine worker. Placeholder until session 2: answers every request with 'done'.
import type { EngineMessage, EngineRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<EngineRequest>) => {
  if (e.data.type === 'autofill') self.postMessage({ type: 'done' } satisfies EngineMessage);
};
