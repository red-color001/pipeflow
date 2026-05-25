# @pipeflow/agent (Node)

Tiny agent SDK that registers a Node service as a live node in the pipeflow topology UI.

## Use

```ts
import { Agent } from '@pipeflow/agent';

const agent = new Agent({
  backend: 'http://pipeflow-server:4000',
  token: process.env.PIPEFLOW_TOKEN!,
  id: 'app-backend',
  label: 'App · Backend',
  node_type: 'be',
  color: 'teal',
  targets: [
    { to: 'postgres', color: 'teal' },
    { to: 'duckdb',   color: 'teal' },
  ],
});

agent.start();
```

`start()` registers and starts a 5s heartbeat. SIGINT/SIGTERM deregister cleanly.
