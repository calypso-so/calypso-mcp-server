# Open a PR to `modelcontextprotocol/servers`

This guide walks you through creating a small docs-only pull request from your terminal to add `Calypso MCP` to the community resources section of:

- `https://github.com/modelcontextprotocol/servers`

It assumes:

- you have `git` installed
- you have the GitHub CLI `gh` installed and authenticated
- you have permission to create forks under your GitHub account

## Goal

Create a PR that adds a community resource entry like this to their `README.md`:

```md
- **[Calypso MCP](https://github.com/calypso-so/calypso-mcp-server)** - Multimodal RAG MCP server for grounded, source-backed answers across PDFs, docs, images, and knowledge files, with agent-store uploads, knowledge-store indexing, and retrieval-backed chat workflows by **Calypso**
```

## 1. Go to a working directory

Pick any directory where you want to clone the upstream repo.

```bash
cd ~/Documents/dev
```

## 2. Fork the upstream repository

If you have not already forked `modelcontextprotocol/servers`, do:

```bash
gh repo fork modelcontextprotocol/servers --clone
```

This will usually:

- create a fork under your GitHub account
- clone it locally into a folder named `servers`
- set up `upstream` to point to the original repo

## 3. Enter the cloned repo

```bash
cd servers
```

## 4. Create a branch for the docs change

```bash
git checkout -b docs/add-calypso-mcp-resource
```

## 5. Open the README and add the Calypso entry

Open `README.md` in your editor and add this line under the `## 📚 Resources` section:

```md
- **[Calypso MCP](https://github.com/calypso-so/calypso-mcp-server)** - Multimodal RAG MCP server for grounded, source-backed answers across PDFs, docs, images, and knowledge files, with agent-store uploads, knowledge-store indexing, and retrieval-backed chat workflows by **Calypso**
```

If you want to do it manually in the terminal:

```bash
code README.md
```

Or use any editor you prefer:

```bash
nano README.md
```

## 6. Verify the change

```bash
git diff
```

You should see only a small README change.

## 7. Commit the change

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: add Calypso MCP to community resources

Add Calypso MCP as a community resource in the README so users browsing MCP ecosystem links can discover the multimodal RAG server and its repository.
EOF
)"
```

## 8. Push your branch

```bash
git push -u origin docs/add-calypso-mcp-resource
```

## 9. Open the pull request with GitHub CLI

```bash
gh pr create --repo modelcontextprotocol/servers --title "docs: add Calypso MCP to community resources" --body "$(cat <<'EOF'
## Summary

Adds Calypso MCP to the community resources list.

Calypso MCP is a multimodal RAG MCP server for grounded, source-backed answers across PDFs, docs, images, and knowledge files. It supports:
- agent-store file uploads that return compatible `file_id` values
- knowledge-store uploads for durable indexing
- retrieval-backed chat workflows for AI agents and apps

Repo: https://github.com/calypso-so/calypso-mcp-server

EOF
)"
```

## 10. If `gh pr create` asks questions

If the CLI asks where to push or which fork to use, choose:

- your fork as `origin`
- `modelcontextprotocol/servers` as the base repo
- `main` as the base branch

## 11. Check the PR URL

After creation, GitHub CLI will print the PR URL. Save it so you can:

- monitor review feedback
- update the branch if maintainers request wording changes

## 12. If you need to update the PR later

Make your README changes, then run:

```bash
git add README.md
git commit -m "docs: refine Calypso MCP resource entry"
git push
```

The PR will update automatically.

## Optional: shortest likely-to-be-accepted entry

If you want a more conservative line in case maintainers prefer shorter wording, use:

```md
- **[Calypso MCP](https://github.com/calypso-so/calypso-mcp-server)** - Multimodal RAG MCP server for grounded answers from PDFs, docs, images, and knowledge files by **Calypso**
```

## Optional: inspect remotes

If you want to confirm your local git remotes before pushing:

```bash
git remote -v
```

You should ideally see:

- `origin` -> your fork
- `upstream` -> `modelcontextprotocol/servers`

## Notes

- This should be a docs-only PR.
- Keep the change limited to `README.md`.
- The upstream repo is focused on reference servers, so a short community resource entry is more likely to be accepted than a large promotional block.
