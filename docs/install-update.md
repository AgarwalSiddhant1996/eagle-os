# Safe installation and updates

Keep a clean versioned source checkout, a code-only installation and external user data as three separate paths. No installer step should delete a populated state folder.

From a reviewed checkout:

```sh
npm run verify
node scripts/install.mjs --target=<code-only-install-directory> --data=<external-user-data-directory>
```

The installer rejects overlaps, symlinks, unknown target files and unrecognized installations. It stages a code-only copy, retains the previous code directory as a backup, then activates it. A failure during activation restores the prior code. It does not alter the external data directory, install skills over user edits or change host/connector settings.

For updates, fetch a selected reviewed source version in the clean checkout. Use a fast-forward-only pull if tracking a branch; do not pull into a mutable data directory. Rerun verification and the installer, then use the host's supported extension reload or restart your standalone server.

The installed server must use the same external data root through `EAGLE_DATA_ROOT` or the explicit CLI flag. The code-only installation marker stores only the app/version/schema and activation time; no personal paths, endpoints or workspace configuration are placed in it. The installer does not change your host environment.

No `--force` overwrite path exists. If unknown personal files are found inside an older installation, stop and move them through a separately verified migration with a backup. Do not delete them to make an update succeed.

Schema version 1 is the only supported data version. A later incompatible version needs a tested migration and a compatible backup. Reinstalling older code is not automatically a safe data rollback.

For a compatible extension host, use its `install_extension` tool on a reviewed repository folder. An isolated test should use session scope, then open the `eagle-os` canvas with a fresh workspace id. The host resolves its supported SDK automatically; `EAGLE_HOST_SDK` is an optional test override. Standalone `npm start` remains available for development.

The project and session identifiers are independent values; creating an actor or schedule needs the actual configured project and explicit authority. Merely opening a canvas does neither.

No auto-update subscription is claimed. Release visibility and distribution remain explicit decisions.
