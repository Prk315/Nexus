# Nexus Ecosystem

A personal life operating system — a suite of interconnected desktop apps built with Tauri 2 (Rust) + React/TypeScript.

## Apps

| App | Description |
|-----|-------------|
| [Nexus](./apps/nexus) | Central hub & launcher. Runs the IPC server (port 1430) and visualizes the app ecosystem in 3D. |
| [PathFinder](./apps/PathFinder) | Life planning — goals, projects, tasks, courses, lifestyle, and more. |
| [Vault](./apps/Vault) | Graph-based knowledge management with rich editing and Python execution. |
| [TimeTrackerApp](./apps/TimeTrackerApp) | Time tracking, focus sessions, site blocking, and productivity analytics. |
| [Stonks](./apps/Stonks) | Financial tracking and portfolio management. |

## Packages

| Package | Description |
|---------|-------------|
| [nexus-core](./packages/nexus-core) | Shared library — IPC client SDK, UI components, and type definitions used by all apps. |

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Backend:** Rust (Tauri 2), SQLite
- **Shared:** nexus-core package with IPC client, shared components, and types
- **IPC:** HTTP-based on port 1430 (all apps register with Nexus on startup)

## Getting Started

```bash
# Install dependencies
npm install

# Run a specific app
npm run dev:nexus
npm run dev:pathfinder
npm run dev:vault
npm run dev:timetracker
npm run dev:stonks
```

## Architecture

All apps communicate through Nexus via HTTP IPC on port 1430. Each app registers itself on startup and can be discovered, launched, and monitored from the Nexus hub.

```
             Nexus (IPC hub, port 1430)
            /       |        \        \
    TimeTracker  Stonks  PathFinder  Vault
    -----------------------------------------
         nexus-core (shared SDK + components)
```
