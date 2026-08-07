// P8 worker-execution follow-up: the actual file `new Worker(new URL(...))`
// points at — a plain relative import is the Vite-documented, guaranteed-to-work
// way to construct a module worker from a package export (see worker-layout.ts).
import '@graphloom/layout/worker';
