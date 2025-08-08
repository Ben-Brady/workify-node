import {
    type Transferable,
    type MessagePort,
    parentPort,
    isMainThread,
    Worker,
} from "node:worker_threads";
import * as os from "node:os";

type Promisify<T extends (...args: any) => any> = T extends (...args: any) => Promise<any>
    ? T
    : (...args: Parameters<T>) => Promise<ReturnType<T>>;

export type FunctionInterface = Record<string, (...args: any[]) => any>;

export type WorkerInterface<T extends FunctionInterface = FunctionInterface> = {
    [Key in keyof T]: Promisify<T[Key]>;
};

export type InferInterface<T extends FunctionInterface> = WorkerInterface<T>;

let transfers: Transferable[] = [];
export const transfer = (value: Transferable) => transfers.push(value);

type WorkerRequest = {
    id: number;
    name: string;
    args: any[];
};
type WorkerResponse = {
    id: number;
    value: any;
    isError: boolean;
};

export const attachMessageHandler = <T extends FunctionInterface>(Interface: T): T => {
    if (isMainThread) throw new Error("Attached message handler to wrong thread");
    if (!parentPort) throw new Error("No parentPort found");

    parentPort.on("message", async (value) => {
        const { id, name, args } = value as WorkerRequest;

        try {
            const value = await Interface[name](...args);
            sendResponse(parentPort!, { id, value, isError: false }, transfers);
        } catch (err) {
            sendResponse(parentPort!, { id, value: err, isError: true });
        }
        transfers = [];
    });

    return Interface;
};

export function createWorker<T extends WorkerInterface>(
    url: URL | string,
): [module: T, worker: Worker] {
    const worker = new Worker(url, {});
    worker.setMaxListeners(0); // disable listener warning

    const api = new Proxy(
        {},
        {
            get(_, name) {
                name = name as string;
                return (...args: any[]) => {
                    const id = Math.random();
                    sendRequest(worker, { id, name, args }, transfers);
                    transfers = [];

                    return new Promise((resolve, reject) => {
                        const onMessage = (data: any) => {
                            const { id: requestId, value, isError } = data;

                            if (requestId !== id) return;
                            if (!isError) {
                                resolve(value);
                            } else {
                                reject(value);
                            }
                            worker.off("message", onMessage);
                        };
                        worker.on("message", onMessage);
                    });
                };
            },
        },
    ) as T;

    return [api, worker];
}

export const createWorkerPool = <T extends WorkerInterface>(
    workerUrl: string,
    size?: number,
): [api: T, workers: Worker[]] => {
    size ??= os.availableParallelism();

    const workers = Array.from({ length: size }, () => createWorker<T>(workerUrl));
    const workerObjects = workers.map((v) => v[1]);

    let index = 0;
    const api = new Proxy(
        {},
        {
            get:
                (_, name: string) =>
                // Need to do a wrapper function, so [].map(pool.foo) isn't the same call
                (...args: any[]) => {
                    index = (index + 1) % size;
                    const api = workers[index][0];
                    const func = api[name as any];
                    return func(...args);
                },
        },
    ) as T;

    return [api, workerObjects];
};

const sendResponse = (
    worker: Worker | MessagePort,
    data: WorkerResponse,
    transfers?: Transferable[],
) => {
    worker.postMessage(data, transfers);
};

const sendRequest = (
    worker: Worker | MessagePort,
    data: WorkerRequest,
    transfers?: Transferable[],
) => {
    worker.postMessage(data, transfers);
};
