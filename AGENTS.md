# Agent instructions

These rules apply to every coding agent working in this repository.

## Push finished work to GitHub

After any code modification, once the change is complete and verified, commit it and push it to GitHub (`origin`, https://github.com/xiwei26/guandan-six). This project commits directly to `main`.

- Run `npm test` before committing. If the change touches `game-src/`, `shared/` or other code bundled into the mini-game, run `npm run build:game` first so the committed `minigame/game.js` matches its source.
- Commit only the files your change touched. Leave unrelated local edits out, such as a locally changed `project.config.json`.
- If `origin/main` has moved, rebase onto it and retest. Never force-push. If tests fail or the push is rejected, report it instead of pushing.

## Always state whether the backend needs redeployment

Every summary of a code change must say clearly, on its own line, one of:

- **Backend redeployment needed**
- **No backend redeployment needed**

The backend is the Docker image built from `Dockerfile`. It contains the Node server and the web client that the server hosts, so redeployment is needed when any of these change:

- `server/`
- `shared/`
- `src/`, `index.html` or `vite.config.ts`
- `package.json` or `package-lock.json`
- `Dockerfile`, `compose.yaml` or `deploy/`

Changes limited to `game-src/`, `minigame/`, `miniprogram/`, tests or docs do not need a backend redeployment. For mini-game changes, also tell the user to recompile in WeChat DevTools, and to upload a new version when releasing.
