# Optional private editor

The public fork contains the upstream game and can run without private access. Custom editor code, gameplay/art
packs, references and operational configuration live in the private companion repository. The public `editor/`
entry is a Git submodule: it tracks a commit pointer, not those files.

## Authorized developer setup

```sh
git clone https://github.com/Iraday/Stronghold-Protocol.git
cd Stronghold-Protocol
git submodule update --init --recursive editor
npm ci
npm --prefix editor ci
npm --prefix editor run setup
npm --prefix editor run doctor
npm --prefix editor run artwork
```

Authenticate GitHub with an account that can read the private companion before initializing it. A 404/permission
error means private access needs fixing; the public game remains usable without it. Do not substitute a public copy.

After initialization read `editor/AGENTS.md` and `editor/README.md`. They contain detailed new-laptop instructions,
ownership rules, native plugin installation, artwork checks, deployment and upstream synchronization. Setup writes
ignored runtime plugin copies and preserves existing local policy; it never deploys or uploads credentials.

## Keep the public boundary intact

- Public: upstream engine/client/data, generic docs and this optional integration.
- Private: editor sources, custom plugin packs, authored art/reference images and deployment details.
- Neither Git repo: passwords, access tokens, SSH private keys, machine state, caches or packed archives.

Private content lives under the submodule's own Git history. Public runtime plugin folders and legacy materialized
editor paths are ignored. `node tools/check-private-boundary.mjs` and the public test suite reject tracked private
payload/credential patterns; an authorized `editor` entry must have Git mode `160000`.

Commit and push private changes first. Then stage `editor`, commit the public pointer and push with
`git -c push.recurseSubmodules=check push <your-fork-remote> main`. Inspect remote URLs: a fresh clone uses `origin`
for this fork; older local worktrees may call it `fork`. Never push to the upstream project's remote.

For parent updates, add/verify an `upstream` remote, fetch it, resolve its default branch using
`git remote set-head upstream -a`, and merge `upstream/HEAD` on a topic branch. Keep this optional integration and
test compatibility using the private guide. Public CI does not initialize the private module or need its credentials.

The current-tree split does not remove private files from previously published history. Do not force-push/rewrite
public history without a separate explicit request; any exposed real credential needs independent rotation.
