import { setTimeout } from 'node:timers';
import { parentPort } from 'node:worker_threads';
setTimeout(() => parentPort.postMessage({ clusters: [], features: [] }), 100);
