# FilmGallery — OpenCode Agents & Tools

## Available Subagents

When you encounter a task that matches one of the specialized subagents below, **delegate it** via the Task tool (`subagent_type`). This saves context, uses the right model, and improves quality.

### `vision` — Visual Analysis
- **Model**: MiniMax-M3 (vision-capable, multimodal, via paratera)
- **When**: Any time you need to read, describe, OCR, or reason about an image file (PNG/JPG/WebP/PDF). You (the primary agent) have NO vision — `vision` is your only way to see images.
- **Triggers**: "what's on this screenshot", "read the error in this image", "describe this poster", "what text is visible in this UI", "check the generated image for X"
- **Permissions**: read, glob, grep, list (read-only, no edits, no bash)

### `imagine` — Image Generation
- **Model**: GLM-5.2 (planner) + calls `generate_image` tool (CogView-3-Flash)
- **When**: User asks to create, draw, generate, design, or make an image, illustration, poster, cover, icon, or visual asset.
- **Triggers**: "generate a poster for X", "create an icon", "draw a landscape", "make a film cover"
- **Output**: Returns the absolute file path to the generated image. The image renders inline in the subagent's session (tool attachment). You can then use `vision` to verify the result.
- **Permissions**: read, glob, grep, list, generate_image (no edits, no bash)

### `review` — Adversarial Code Review
- **Model**: DeepSeek V4 Pro (reasoning, different vendor than GLM for cross-vendor diversity)
- **When**: After writing or modifying code — to catch bugs, security issues, edge cases you missed. Different model vendor = genuine independent review.
- **Triggers**: "review this diff", "check this PR", "audit this function for security", "verify this change before commit"
- **Input**: Give the reviewer a diff, file path, or function name. It will read context and return structured findings (Critical / Warning / Nit / Checked Clean).
- **Permissions**: read, glob, grep, list, git read-only commands (diff/log/show/status/blame). No edits, no destructive bash.

### `quick` — Fast Simple Tasks (DeepSeek V4 Flash)
- **Model**: DeepSeek V4 Flash (fast, cheap, reasoning-lite)
- **When**: Short, well-scoped, single-step chores. No exploration, no multi-step planning, no >50-line output.
- **Triggers**: "rename variable X to Y in file Z", "write a one-off script to do W", "summarize this file", "what command does A", "generate a commit message for staged changes", "run `cmd` and report output"
- **Commit message workflow**: Run `git status` + `git diff --staged` + `git log --oneline -5` to learn style, then output Conventional Commits format. Do NOT run `git commit`.
- **Not for**: Multi-step refactors, architecture decisions, exploration ("how does X work" → `explore`).

### `coder` — Coding Executor (GLM-5.2)
- **Model**: zhipuai-coding-plan/glm-5.2 (same model as the primary agent — design intent transfers with zero cross-model drift)
- **When**: The primary agent delegates concrete coding work — implementing a designed feature, fixing an identified bug, refactoring a bounded set of files, writing tests. This is the project's primary coding executor.
- **Triggers**: "implement X", "fix bug Y", "refactor Z", "write tests for W", `/new-api-endpoint`, `/new-mobile-screen`
- **Permissions**: read, glob, grep, list, edit, bash (lint/test/build/git). No task, no webfetch.
- **Self-check**: shares the primary agent's blind spots — always route non-trivial finished code through `@review` for an independent cross-vendor check.

### `general` — Complex Multi-Step Tasks (built-in, GLM-5.2)
- **When**: Tasks too complex for `quick` but not fitting `review`/`explore`/`vision`. Multi-file refactors, implementing features that span modules, debugging chains across components.
- **Full tool access** (except todo).

### `explore` — Codebase Exploration (built-in)
- **When**: Finding files by patterns, searching for keyword usage across the codebase, answering "how does X work in this project", tracing dependencies.
- **Read-only**. No file modifications.

### `scout` — External Dependency Research (built-in)
- **When**: Inspecting library source in opencode's managed cache (cloned repos), cross-referencing local code against upstream.

## FilmGallery Domain Subagents

Most domain implementation work now flows through `@coder` (GLM-5.2) with the matching skill auto-loaded — no per-domain agent needed. One specialist is retained where the domain is constrained enough to warrant a dedicated implementer.

### `rendering-expert` — Render Pipeline (DeepSeek V4 Pro)
- **When**: Film rendering pipeline, image processing, color science, GLSL shaders, Float32, CPU/GPU consistency.
- **Triggers**: "rendering bug", "color shift", "Float32 pipeline", "shader mismatch"
- **Permissions**: read, edit, bash (npm test/git)
- **Why kept**: The Float32 pipeline has immutable stage ordering and strict CPU/GPU parity constraints — a dedicated agent enforces them. Use `@coder` for routine rendering edits; escalate here for pipeline-level bugs.

## Domain Skills

On-demand contextual knowledge loaded into the current session when a task matches. Located in `.opencode/skills/`.

| Skill | Covers | Trigger area |
|-------|--------|--------------|
| `client-dev` | React desktop: HeroUI, Tailwind, React Query, jsonFetch | `client/src/**` |
| `server-dev` | Express routes/services, PreparedStmt, error handling | `server/**` |
| `database-dev` | SQLite, WAL, migrations, prepared statements | `server/db.js`, migrations |
| `mobile-dev-domain` | Expo + TypeScript, StyleSheet, Paper, api-client, navigation | `mobile/**` |
| `rendering-dev` | RenderCore.processPixelFloat, Float32 pipeline, GLSL, filmLab modules | `packages/shared/**` |
| `electron-dev` | Main/preload, IPC, window.__electron, electron-builder | `electron-*.js` |
| `docker-deploy` | Dockerfile, compose, NAS, SERVER_MODE, buildx | `docker/**` |
| `watch-dev` | Wear OS, TypeScript, RN primitives (no Paper), StyleSheet, compact UI | `watch-app/**` |

Plus the environment playbooks: `browser-e2e-testing`, `desktop-ci-build`, `mobile-android-build`.

## Slash Commands

Reusable workflows in `.opencode/commands/`. Invoke as `/command <args>`.

| Command | Routes to | Does |
|---------|-----------|------|
| `/new-api-endpoint` | `coder` | Full-stack endpoint: route + service + client module + React Query hook |
| `/new-component` | primary | New desktop React component (HeroUI + Tailwind + React Query) |
| `/new-migration` | primary | New SQLite schema migration (idempotent, indexed, snake_case) |
| `/new-mobile-screen` | `coder` | New React Native TypeScript screen (StyleSheet + Paper + navigation) |
| `/fix-rendering` | `rendering-expert` | Diagnose/fix render pipeline issues (Float32, shaders, consistency) |

## Custom Tools

### `generate_image`
- **What**: Calls Zhipu CogView-3-Flash (cogview-3-flash) via `open.bigmodel.cn/api/paas/v4/images/generations`
- **Args**: `prompt` (required, English preferred for accuracy), `size` (1024x1024|768x1344|1344x768|720x1080|1080x720, default 1024x1024), `filename` (optional)
- **Returns**: `{ output: "Image generated successfully. File: /path/to/image.jpg...", attachments: [{ type: "file", mime, url: "data:...", filename }] }` — the attachment renders the image inline in the tool-result panel.
- **Output directory**: `tmp/generated-images/` (gitignored)
- **API key**: Auto-reads from `~/.local/share/opencode/auth.json` (zhipuai-coding-plan). No env var needed.
- **Note**: This tool is called by `imagine` subagent in normal flow. Call it directly only for simple generate-and-done requests.

## Delegation Decision Tree

```
Task fits
├── "look at this image / screenshot / poster"          → @vision
├── "generate / create / draw an image / poster / icon" → @imagine
├── "review this code / diff / PR for bugs"             → @review
├── "implement feature / fix bug / refactor / tests"    → @coder
├── "rename X / run one command / summarize file / commit message" → @quick
├── "explore codebase / find how X works"               → @explore
├── "look up upstream library source"                   → @scout
├── "rendering bug / Float32 / shader / color shift"    → @rendering-expert (or `/fix-rendering`)
├── complex multi-step task not fitting above           → @general (or handle yourself)
```

Domain conventions for the area you're editing are auto-loaded via the skills above — no need to memorize them.

## Project Conventions

### Build & Test
- **Desktop (Electron)**: `npm run dev` (Vite dev server + Electron)
- **Mobile (Expo)**: `cd mobile && npx expo start`
- **Lint**: `npx eslint .` at root
- **TypeScript**: The project uses JSX files under `client/src/` (not TSX). Do not convert to TSX.
- **Node**: 18.19+

### Architecture
```
FilmGallery/
├── client/        — React + Vite desktop frontend (JSX components)
├── mobile/        — Expo SDK 54 / React Native mobile app
├── packages/      — Shared libraries (@filmgallery/*)
├── server/        — Backend (Express + SQLite)
├── electron-*     — Electron main/preload
├── docker/        — Docker deployment
├── docs/          — Documentation and analysis
└── tools/         — Build scripts
```

### Key Conventions
- File modifications: use `edit` tool with exact string matches (not `write` for existing files)
- Git commit style: Conventional Commits — `type(scope): description` with imperative mood
- Do NOT add comments to code unless asked
- Do NOT create documentation files (*.md) unless explicitly requested
- Minimize output tokens — one-word answers preferred when questions are factual
