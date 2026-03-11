# Integrate Reclaim Protocol

You are integrating Reclaim Protocol into the current project. Follow every step below exactly. Do not skip steps or improvise.

---

## Step 1: Detect the project stack

Read `package.json` in the project root. If it does not exist, stop and tell the user: "No package.json found. Initialize a Node.js project first with `npm init`."

Determine the **framework** by checking `dependencies` and `devDependencies` for these keys, evaluated in this order (first match wins):

| Check                                                                | Framework                        |
| -------------------------------------------------------------------- | -------------------------------- |
| `next` is a dependency AND directory `app/` exists at project root   | **Next.js App Router**           |
| `next` is a dependency AND directory `pages/` exists at project root | **Next.js Pages Router**         |
| `next` is a dependency (neither `app/` nor `pages/` exists)          | **Next.js App Router** (default) |
| `nuxt` or `nuxt3` is a dependency                                    | **Nuxt**                         |
| `@sveltejs/kit` is a dependency                                      | **SvelteKit**                    |
| `express` is a dependency                                            | **Express**                      |
| `fastify` is a dependency                                            | **Fastify**                      |
| `hono` is a dependency                                               | **Hono**                         |
| `react` is a dependency (no framework above matched)                 | **React (Vite/CRA)**             |
| `vue` is a dependency (no framework above matched)                   | **Vue**                          |
| None of the above                                                    | **Plain Node.js**                |

Determine the **package manager** by checking for lock files in this order:

| File exists                              | Package manager |
| ---------------------------------------- | --------------- |
| `bun.lockb` or `bun.lock`                | `bun`           |
| `pnpm-lock.yaml`                         | `pnpm`          |
| `yarn.lock`                              | `yarn`          |
| `package-lock.json` or none of the above | `npm`           |

Determine **TypeScript** usage: the project uses TypeScript if `typescript` is in `dependencies` or `devDependencies`, or if `tsconfig.json` exists at the project root.

Tell the user what you detected. Example: "Detected **Next.js App Router** with **pnpm** and **TypeScript**."

---

## Step 2: Collect credentials

Ask the user for all three values in a single prompt:

1. **App ID** — their Reclaim Application ID
2. **App Secret** — their Reclaim Application Secret
3. **Provider ID** — the Provider ID for the data source they want to verify

Tell them: "Get these from https://dev.reclaimprotocol.org — create an application, copy the App ID and App Secret, then add a provider and copy its Provider ID."

Do not proceed until you have all three values.

---

## Step 3: Install dependencies

Run the install command using the detected package manager:

```
<package-manager> install @reclaimprotocol/js-sdk
```

For frameworks that have a frontend component (React, Vue, Next.js, Nuxt, SvelteKit), also install the QR code library:

- React / Next.js: `react-qr-code`
- Vue / Nuxt: `vue-qrcode-reader` (note: not needed — use a `<a>` link instead; skip this)
- SvelteKit: skip QR library; use a `<a>` link instead

**Correction — simplified rule:** Only install `react-qr-code` alongside the SDK when the project uses React (including Next.js). For all other frameworks, only install `@reclaimprotocol/js-sdk`.

```
<package-manager> install @reclaimprotocol/js-sdk react-qr-code
```

or (non-React projects):

```
<package-manager> install @reclaimprotocol/js-sdk
```

---

## Step 4: Create the `.env.local` file

Write a `.env.local` file at the project root with exactly this content (substitute the user's actual values):

```
RECLAIM_APP_ID=<user's App ID>
RECLAIM_APP_SECRET=<user's App Secret>
RECLAIM_PROVIDER_ID=<user's Provider ID>
```

If the project is **Next.js** or **Nuxt**, also add a public-facing base URL variable:

```
RECLAIM_APP_ID=<user's App ID>
RECLAIM_APP_SECRET=<user's App Secret>
RECLAIM_PROVIDER_ID=<user's Provider ID>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For Nuxt, use `NUXT_PUBLIC_APP_URL` instead of `NEXT_PUBLIC_APP_URL`.

If `.gitignore` exists, check that `.env.local` is listed. If it is not, append `.env.local` on a new line at the end.

---

## Step 5: Resolve the callback URL

The callback URL is where Reclaim sends proofs after verification. It must be publicly reachable.

Apply this logic in order:

1. **Check for `APP_URL` or equivalent env variable.** Read `.env`, `.env.local`, and `.env.production` for any of: `APP_URL`, `NEXT_PUBLIC_APP_URL`, `NUXT_PUBLIC_APP_URL`, `BASE_URL`, `VITE_APP_URL`. If found and the value starts with `https://`, use it as the base URL.

2. **Check for ngrok.** Run `which ngrok`. If ngrok is installed, tell the user: "Run `ngrok http <port>` in a separate terminal to get a public URL, then paste the https URL here." Wait for their response and use that URL as the base URL.

3. **Neither available.** Tell the user: "No public URL detected. For local development, install ngrok (`npm install -g ngrok` or `brew install ngrok`), run `ngrok http <port>`, and set `APP_URL` in `.env.local` to the ngrok https URL. Callbacks will not work on localhost without a tunnel."

Store the resolved base URL. The callback endpoint will be `<base-url>/api/reclaim/callback`.

---

## Step 6: Write the integration code

Write code based on the detected framework. Use TypeScript (`.ts` / `.tsx`) if the project uses TypeScript, otherwise use JavaScript (`.js` / `.jsx`).

---

### Next.js App Router

**File: `app/api/reclaim/generate-config/route.ts`**

```typescript
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";
import { NextResponse } from "next/server";

export async function GET() {
  const reclaimProofRequest = await ReclaimProofRequest.init(
    process.env.RECLAIM_APP_ID!,
    process.env.RECLAIM_APP_SECRET!,
    process.env.RECLAIM_PROVIDER_ID!,
  );

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/reclaim/callback`;
  reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

  const reclaimConfig = reclaimProofRequest.toJsonString();
  return NextResponse.json({ reclaimConfig });
}
```

**File: `app/api/reclaim/callback/route.ts`**

```typescript
import { verifyProof, Proof } from "@reclaimprotocol/js-sdk";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const proof = (await request.json()) as Proof;

  const isValid = await verifyProof(proof);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid proof" }, { status: 400 });
  }

  // TODO: Process the verified proof (e.g., save to database, update user record)
  console.log("Verified proof received:", proof.claimData);

  return NextResponse.json({ success: true });
}
```

**File: `app/components/ReclaimVerification.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";
import QRCode from "react-qr-code";

export default function ReclaimVerification() {
  const [requestUrl, setRequestUrl] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "ready" | "success" | "error"
  >("idle");

  async function startVerification() {
    setStatus("loading");

    const response = await fetch("/api/reclaim/generate-config");
    const { reclaimConfig } = await response.json();

    const reclaimProofRequest = await ReclaimProofRequest.fromJsonString(
      reclaimConfig,
    );
    const url = await reclaimProofRequest.getRequestUrl();
    setRequestUrl(url);
    setStatus("ready");

    await reclaimProofRequest.startSession({
      onSuccess: () => {
        setStatus("success");
      },
      onError: (error) => {
        console.error("Verification failed:", error);
        setStatus("error");
      },
    });
  }

  return (
    <div>
      {status === "idle" && (
        <button onClick={startVerification}>Verify with Reclaim</button>
      )}
      {status === "loading" && <p>Initializing...</p>}
      {status === "ready" && requestUrl && (
        <div>
          <p>Scan this QR code to verify:</p>
          <QRCode value={requestUrl} />
        </div>
      )}
      {status === "success" && <p>Verification successful!</p>}
      {status === "error" && (
        <div>
          <p>Verification failed. Please try again.</p>
          <button onClick={startVerification}>Retry</button>
        </div>
      )}
    </div>
  );
}
```

---

### Next.js Pages Router

**File: `pages/api/reclaim/generate-config.ts`**

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end();

  const reclaimProofRequest = await ReclaimProofRequest.init(
    process.env.RECLAIM_APP_ID!,
    process.env.RECLAIM_APP_SECRET!,
    process.env.RECLAIM_PROVIDER_ID!,
  );

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/reclaim/callback`;
  reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

  const reclaimConfig = reclaimProofRequest.toJsonString();
  res.json({ reclaimConfig });
}
```

**File: `pages/api/reclaim/callback.ts`**

```typescript
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyProof, Proof } from "@reclaimprotocol/js-sdk";

export const config = { api: { bodyParser: true } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end();

  const proof = req.body as Proof;
  const isValid = await verifyProof(proof);

  if (!isValid) {
    return res.status(400).json({ error: "Invalid proof" });
  }

  // TODO: Process the verified proof
  console.log("Verified proof received:", proof.claimData);

  return res.json({ success: true });
}
```

**File: `components/ReclaimVerification.tsx`**

Use the same component as Next.js App Router above, but remove the `'use client';` directive.

---

### Express

**File: `routes/reclaim.js` (or `.ts`)**

```javascript
const express = require("express");
const { ReclaimProofRequest, verifyProof } = require("@reclaimprotocol/js-sdk");

const router = express.Router();

router.get("/generate-config", async (req, res) => {
  const reclaimProofRequest = await ReclaimProofRequest.init(
    process.env.RECLAIM_APP_ID,
    process.env.RECLAIM_APP_SECRET,
    process.env.RECLAIM_PROVIDER_ID,
  );

  const callbackUrl = `${process.env.APP_URL}/api/reclaim/callback`;
  reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

  const reclaimConfig = reclaimProofRequest.toJsonString();
  res.json({ reclaimConfig });
});

router.post("/callback", async (req, res) => {
  const proof = req.body;

  const isValid = await verifyProof(proof);
  if (!isValid) {
    return res.status(400).json({ error: "Invalid proof" });
  }

  // TODO: Process the verified proof
  console.log("Verified proof received:", proof.claimData);

  return res.json({ success: true });
});

module.exports = router;
```

Then tell the user to add this to their main Express app file (e.g., `app.js` or `server.js`):

```javascript
// Add these if not already present:
// app.use(express.json());
// app.use(express.text({ type: '*/*', limit: '50mb' }));

const reclaimRoutes = require("./routes/reclaim");
app.use("/api/reclaim", reclaimRoutes);
```

Also update `.env.local` to use `APP_URL` instead of `NEXT_PUBLIC_APP_URL`:

```
APP_URL=<resolved base URL>
```

---

### Fastify

**File: `routes/reclaim.js` (or `.ts`)**

```javascript
const { ReclaimProofRequest, verifyProof } = require("@reclaimprotocol/js-sdk");

async function reclaimRoutes(fastify) {
  fastify.get("/api/reclaim/generate-config", async (request, reply) => {
    const reclaimProofRequest = await ReclaimProofRequest.init(
      process.env.RECLAIM_APP_ID,
      process.env.RECLAIM_APP_SECRET,
      process.env.RECLAIM_PROVIDER_ID,
    );

    const callbackUrl = `${process.env.APP_URL}/api/reclaim/callback`;
    reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

    return { reclaimConfig: reclaimProofRequest.toJsonString() };
  });

  fastify.post("/api/reclaim/callback", async (request, reply) => {
    const proof = request.body;

    const isValid = await verifyProof(proof);
    if (!isValid) {
      return reply.status(400).send({ error: "Invalid proof" });
    }

    // TODO: Process the verified proof
    console.log("Verified proof received:", proof.claimData);

    return { success: true };
  });
}

module.exports = reclaimRoutes;
```

Tell the user to register the plugin in their main Fastify file:

```javascript
fastify.register(require("./routes/reclaim"));
```

Use `APP_URL` in `.env.local`.

---

### Hono

**File: `src/reclaim.js` (or `.ts`)**

```typescript
import { Hono } from "hono";
import { ReclaimProofRequest, verifyProof } from "@reclaimprotocol/js-sdk";

const reclaim = new Hono();

reclaim.get("/generate-config", async (c) => {
  const reclaimProofRequest = await ReclaimProofRequest.init(
    process.env.RECLAIM_APP_ID!,
    process.env.RECLAIM_APP_SECRET!,
    process.env.RECLAIM_PROVIDER_ID!,
  );

  const callbackUrl = `${process.env.APP_URL}/api/reclaim/callback`;
  reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

  return c.json({ reclaimConfig: reclaimProofRequest.toJsonString() });
});

reclaim.post("/callback", async (c) => {
  const proof = await c.req.json();

  const isValid = await verifyProof(proof);
  if (!isValid) {
    return c.json({ error: "Invalid proof" }, 400);
  }

  // TODO: Process the verified proof
  console.log("Verified proof received:", proof.claimData);

  return c.json({ success: true });
});

export default reclaim;
```

Tell the user to mount the route in their main Hono app:

```typescript
import reclaim from "./reclaim";
app.route("/api/reclaim", reclaim);
```

Use `APP_URL` in `.env.local`.

---

### React (Vite / CRA) — frontend only

**File: `src/components/ReclaimVerification.jsx` (or `.tsx`)**

```tsx
import { useState } from "react";
import { ReclaimProofRequest, verifyProof } from "@reclaimprotocol/js-sdk";
import QRCode from "react-qr-code";

const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID;
const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET;
const PROVIDER_ID = import.meta.env.VITE_RECLAIM_PROVIDER_ID;

export default function ReclaimVerification() {
  const [requestUrl, setRequestUrl] = useState("");
  const [proofs, setProofs] = useState(null);
  const [status, setStatus] = useState("idle");

  async function startVerification() {
    setStatus("loading");

    const reclaimProofRequest = await ReclaimProofRequest.init(
      APP_ID,
      APP_SECRET,
      PROVIDER_ID,
    );
    const url = await reclaimProofRequest.getRequestUrl();
    setRequestUrl(url);
    setStatus("ready");

    await reclaimProofRequest.startSession({
      onSuccess: (receivedProofs) => {
        setProofs(receivedProofs);
        setStatus("success");
      },
      onError: (error) => {
        console.error("Verification failed:", error);
        setStatus("error");
      },
    });
  }

  return (
    <div>
      {status === "idle" && (
        <button onClick={startVerification}>Verify with Reclaim</button>
      )}
      {status === "loading" && <p>Initializing...</p>}
      {status === "ready" && requestUrl && (
        <div>
          <p>Scan this QR code to verify:</p>
          <QRCode value={requestUrl} />
        </div>
      )}
      {status === "success" && <p>Verification successful!</p>}
      {status === "error" && (
        <div>
          <p>Verification failed.</p>
          <button
            onClick={() => {
              setStatus("idle");
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
```

Update `.env.local` to use Vite-prefixed variables:

```
VITE_RECLAIM_APP_ID=<user's App ID>
VITE_RECLAIM_APP_SECRET=<user's App Secret>
VITE_RECLAIM_PROVIDER_ID=<user's Provider ID>
```

**Warn the user:** "This is a frontend-only integration. Your App Secret is exposed in the browser bundle. For production, move initialization to a backend and use the backend-to-frontend config pattern (see Express or Next.js sections)."

---

### Vue — frontend only

**File: `src/components/ReclaimVerification.vue`**

```vue
<template>
  <div>
    <button v-if="status === 'idle'" @click="startVerification">
      Verify with Reclaim
    </button>
    <p v-if="status === 'loading'">Initializing...</p>
    <div v-if="status === 'ready' && requestUrl">
      <p>Open this link on your phone to verify:</p>
      <a :href="requestUrl" target="_blank">{{ requestUrl }}</a>
    </div>
    <p v-if="status === 'success'">Verification successful!</p>
    <div v-if="status === 'error'">
      <p>Verification failed.</p>
      <button @click="status = 'idle'">Retry</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

const requestUrl = ref("");
const status = ref("idle");

async function startVerification() {
  status.value = "loading";

  const reclaimProofRequest = await ReclaimProofRequest.init(
    import.meta.env.VITE_RECLAIM_APP_ID,
    import.meta.env.VITE_RECLAIM_APP_SECRET,
    import.meta.env.VITE_RECLAIM_PROVIDER_ID,
  );

  const url = await reclaimProofRequest.getRequestUrl();
  requestUrl.value = url;
  status.value = "ready";

  await reclaimProofRequest.startSession({
    onSuccess: () => {
      status.value = "success";
    },
    onError: (error) => {
      console.error("Verification failed:", error);
      status.value = "error";
    },
  });
}
</script>
```

Use `VITE_`-prefixed env vars in `.env.local`. Warn about exposed App Secret (same as React frontend-only).

---

### Nuxt

**File: `server/api/reclaim/generate-config.get.ts`**

```typescript
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();

  const reclaimProofRequest = await ReclaimProofRequest.init(
    config.reclaimAppId,
    config.reclaimAppSecret,
    config.reclaimProviderId,
  );

  const callbackUrl = `${config.public.appUrl}/api/reclaim/callback`;
  reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

  return { reclaimConfig: reclaimProofRequest.toJsonString() };
});
```

**File: `server/api/reclaim/callback.post.ts`**

```typescript
import { verifyProof } from "@reclaimprotocol/js-sdk";

export default defineEventHandler(async (event) => {
  const proof = await readBody(event);

  const isValid = await verifyProof(proof);
  if (!isValid) {
    throw createError({ statusCode: 400, message: "Invalid proof" });
  }

  // TODO: Process the verified proof
  console.log("Verified proof received:", proof.claimData);

  return { success: true };
});
```

**File: `components/ReclaimVerification.vue`**

```vue
<template>
  <div>
    <button v-if="status === 'idle'" @click="startVerification">
      Verify with Reclaim
    </button>
    <p v-if="status === 'loading'">Initializing...</p>
    <div v-if="status === 'ready' && requestUrl">
      <p>Open this link on your phone to verify:</p>
      <a :href="requestUrl" target="_blank">{{ requestUrl }}</a>
    </div>
    <p v-if="status === 'success'">Verification successful!</p>
    <div v-if="status === 'error'">
      <p>Verification failed.</p>
      <button @click="status = 'idle'">Retry</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";

const requestUrl = ref("");
const status = ref("idle");

async function startVerification() {
  status.value = "loading";

  const { reclaimConfig } = await $fetch("/api/reclaim/generate-config");
  const reclaimProofRequest = await ReclaimProofRequest.fromJsonString(
    reclaimConfig,
  );

  const url = await reclaimProofRequest.getRequestUrl();
  requestUrl.value = url;
  status.value = "ready";

  await reclaimProofRequest.startSession({
    onSuccess: () => {
      status.value = "success";
    },
    onError: (error) => {
      console.error("Verification failed:", error);
      status.value = "error";
    },
  });
}
</script>
```

Update `nuxt.config.ts` to include runtime config:

```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    reclaimAppId: process.env.RECLAIM_APP_ID,
    reclaimAppSecret: process.env.RECLAIM_APP_SECRET,
    reclaimProviderId: process.env.RECLAIM_PROVIDER_ID,
    public: {
      appUrl: process.env.NUXT_PUBLIC_APP_URL || "http://localhost:3000",
    },
  },
});
```

`.env.local` for Nuxt:

```
RECLAIM_APP_ID=<value>
RECLAIM_APP_SECRET=<value>
RECLAIM_PROVIDER_ID=<value>
NUXT_PUBLIC_APP_URL=http://localhost:3000
```

---

### SvelteKit

**File: `src/routes/api/reclaim/generate-config/+server.ts`**

```typescript
import { json } from "@sveltejs/kit";
import { ReclaimProofRequest } from "@reclaimprotocol/js-sdk";
import {
  RECLAIM_APP_ID,
  RECLAIM_APP_SECRET,
  RECLAIM_PROVIDER_ID,
} from "$env/static/private";
import { PUBLIC_APP_URL } from "$env/static/public";

export async function GET() {
  const reclaimProofRequest = await ReclaimProofRequest.init(
    RECLAIM_APP_ID,
    RECLAIM_APP_SECRET,
    RECLAIM_PROVIDER_ID,
  );

  const callbackUrl = `${PUBLIC_APP_URL}/api/reclaim/callback`;
  reclaimProofRequest.setAppCallbackUrl(callbackUrl, true);

  return json({ reclaimConfig: reclaimProofRequest.toJsonString() });
}
```

**File: `src/routes/api/reclaim/callback/+server.ts`**

```typescript
import { json, error } from "@sveltejs/kit";
import { verifyProof } from "@reclaimprotocol/js-sdk";

export async function POST({ request }) {
  const proof = await request.json();

  const isValid = await verifyProof(proof);
  if (!isValid) {
    throw error(400, "Invalid proof");
  }

  // TODO: Process the verified proof
  console.log("Verified proof received:", proof.claimData);

  return json({ success: true });
}
```

**File: `src/lib/components/ReclaimVerification.svelte`**

```svelte
<script>
  import { ReclaimProofRequest } from '@reclaimprotocol/js-sdk';

  let requestUrl = '';
  let status = 'idle';

  async function startVerification() {
    status = 'loading';

    const response = await fetch('/api/reclaim/generate-config');
    const { reclaimConfig } = await response.json();

    const reclaimProofRequest = await ReclaimProofRequest.fromJsonString(reclaimConfig);
    const url = await reclaimProofRequest.getRequestUrl();
    requestUrl = url;
    status = 'ready';

    await reclaimProofRequest.startSession({
      onSuccess: () => { status = 'success'; },
      onError: (error) => {
        console.error('Verification failed:', error);
        status = 'error';
      },
    });
  }
</script>

{#if status === 'idle'}
  <button on:click={startVerification}>Verify with Reclaim</button>
{:else if status === 'loading'}
  <p>Initializing...</p>
{:else if status === 'ready' && requestUrl}
  <div>
    <p>Open this link on your phone to verify:</p>
    <a href={requestUrl} target="_blank">{requestUrl}</a>
  </div>
{:else if status === 'success'}
  <p>Verification successful!</p>
{:else if status === 'error'}
  <div>
    <p>Verification failed.</p>
    <button on:click={() => { status = 'idle'; }}>Retry</button>
  </div>
{/if}
```

`.env.local` for SvelteKit:

```
RECLAIM_APP_ID=<value>
RECLAIM_APP_SECRET=<value>
RECLAIM_PROVIDER_ID=<value>
PUBLIC_APP_URL=http://localhost:5173
```

---

### Plain Node.js (no framework)

**File: `reclaim-server.js`**

```javascript
const http = require("http");
const { ReclaimProofRequest, verifyProof } = require("@reclaimprotocol/js-sdk");

const APP_ID = process.env.RECLAIM_APP_ID;
const APP_SECRET = process.env.RECLAIM_APP_SECRET;
const PROVIDER_ID = process.env.RECLAIM_PROVIDER_ID;
const APP_URL = process.env.APP_URL || "http://localhost:3000";

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/reclaim/generate-config") {
    const reclaimProofRequest = await ReclaimProofRequest.init(
      APP_ID,
      APP_SECRET,
      PROVIDER_ID,
    );
    reclaimProofRequest.setAppCallbackUrl(
      `${APP_URL}/api/reclaim/callback`,
      true,
    );
    const reclaimConfig = reclaimProofRequest.toJsonString();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reclaimConfig }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/reclaim/callback") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      const proof = JSON.parse(body);
      const isValid = await verifyProof(proof);
      if (!isValid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid proof" }));
        return;
      }
      // TODO: Process the verified proof
      console.log("Verified proof received:", proof.claimData);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(3000, () =>
  console.log("Server running on http://localhost:3000"),
);
```

`.env.local`:

```
RECLAIM_APP_ID=<value>
RECLAIM_APP_SECRET=<value>
RECLAIM_PROVIDER_ID=<value>
APP_URL=http://localhost:3000
```

---

## Step 7: Summary

After writing all files, print a summary like this:

```
Reclaim Protocol integration complete.

Files created:
  - <list each file created>
  - .env.local

Next steps:
  1. Make sure your dev server is running
  2. For local development, run `ngrok http <port>` and update the APP_URL in .env.local
  3. Import and use the <ReclaimVerification> component wherever you need verification
  4. Handle verified proofs in the callback endpoint (marked with TODO)
  5. For production, set APP_URL to your deployed domain
```
