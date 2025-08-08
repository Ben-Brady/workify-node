# Workify Node

A version of @nnilky/workify for Node.js workers, allowing to create worker interfaces to make requests

```shell
npm install @nnilky/workify-node
```

## Example

```ts
// worker.ts
import { attachMessageHandler, type InferInterface } from "@nnilky/workify-node";

const add = (a: number, b: number) => a + b;

const handler = attachMessageHandler({ add });
export type Interface = InferInterface<typeof handler>;
onmessage = handler;
```

```ts
// client.ts
import { createWorker } from "@nnilky/workify-node";
import type { Interface } from "./worker";

const [worker] = createWorker<Interface>("./worker");

const result = await worker.add(1, 2);
console.log(`1 + 2 = ${result}`);
```

## Worker Pool

You can construct a worker pool the same way you'd make a worker. You can optionally specify the number of workers to use with the default being `os.availableParallelism()`.

```ts
import { createWorkerPool } from "@nnilky/workify-node";
import type { Interface } from "./worker";

const [worker] = createWorkerPool<Interface>("./worker");

const promises = []
for (let i = 0; i < 16; i++) {
    promises.push(worker.renderFrame(index))
}
const frames = await Promise.all(promises)
```

This just redirects each function call to a different worker round robin style.

## Transfers

In order to transfer objects to and from workers, use `transfer()`. You can only transfer types that are [Transferable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects#supported_objects).

```ts
// In client
import { transfer } from "@nnilky/workify-node";
import type { Interface } from "./worker";

const [worker] = createWorker<Interface>("./worker");

const canvas = new OffscreenCanvas(100,100)
const image = canvas.transferToImageBitmap()
transfer(image)
worker.resizeImage(image)
```

```ts
// In a worker
import { transfer } from "@nnilky/workify-node";

const createImage = () => {
    const canvas = new OffscreenCanvas(100,100)
    const image = canvas.transferToImageBitmap()

    transfer(image)
    return image
}

const handler = attachMessageHandler({ createImage });
export type Interface = InferInterface<typeof handler>;
```

This works under the hood by creating a list of values that are included in the transfers in the next request/reponse.

Because of this, It's critical you do this right before sending a request/returning a response. This to avoid any race conditions caused by sending those objects with different request/response.

```ts
// ❌ Incorrect
const image = await createImage()
transfer(image)

const thumbnail = await generateThumbnail(image)
transfer(thumbnail)

return { image, thumbnail }

// ✔️ Correct
const image = await createImage()
const thumbnail = await generateThumbnail(image)

transfer(image)
transfer(thumbnail)
return { image, thumbnail }
```

## Cleanup

In order to terminate workers when you don't need them, `createWorker` and `createWorkerPool` both return the actual workers as their second return value. You can use this to terminate your worker when you no longer need it.

Here's an example for a single request:

```ts
const [api, worker] = createWorker("./worker");
const result = await api.foo()
worker.terminate()
```

## How it works

Under the hood, when you try to call a method on a worker, the reference to the function is proxied. Only the function name and arguments are sent to the worker, this is then recieved on the other end and mapped to the correct function.

The `Interface` generic lets you have a usable developer experience by providing proper typing to the proxy object, otherwise you'll get no type completition on what methods are available.
