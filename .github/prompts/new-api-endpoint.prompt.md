---
description: "Create a new full-stack API endpoint with server route, service, client API module, and React Query integration"
agent: "api-designer"
argument-hint: "Describe the resource and operations needed, e.g. 'CRUD for film presets with name, settings JSON, and film_id foreign key'"
---
Create a new full-stack API endpoint for FilmGallery. Implement all 4 layers:

1. **Server Service** (`server/services/`) — Business logic with PreparedStmt queries
2. **Server Route** (`server/routes/`) — Express router with async/await + try-catch
3. **Client API** (`client/src/api/`) — Function using jsonFetch, exported via index.js
4. **React Query** — Hook usage with appropriate CACHE_STRATEGIES tier

Follow these conventions:
- Route path: kebab-case (`/api/resource-name`)
- DB fields: snake_case
- JS variables: camelCase
- Use PreparedStmt for all queries (no string concatenation)
- Add proper error handling at every layer
