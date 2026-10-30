# thinkNXG Workspace Studio

Visual administrator workspace design and guarded native publishing for **Frappe / ERPNext v16**.

## Install

```bash
cd ~/frappe-bench
bench get-app https://github.com/thinknxg/Workspace-Studio.git
bench --site your-site install-app thinknxg_workspace_studio
bench --site your-site migrate
bench build --app thinknxg_workspace_studio
bench --site your-site clear-cache
bench restart
```

Open `/app/workspace-studio`.

## Native publishing

Studio manages native Workspace blocks (content + reference tables), Sidebar/Workspace Sidebar, Dock, and Desktop Icon documents. Each native document is backed up before publishing; rollback is available via `thinknxg_workspace_studio.api.rollback`. Only supported Frappe fields are written; unknown component schemas are rejected.

Publishing must be enabled explicitly via **Studio Settings → Enable Guarded Publishing**, after testing on a staging site. The implementation is schema-aware but has **not** been tested on your actual v16 installation. Do not enable publishing in production without validation.

## Known limitations

- The UI provides JSON editors for navigation and dock configuration; dedicated visual drag-and-drop editors for these are not yet included.
- User/department/company assignments are stored, but native runtime personalization is not yet wired into Desk.
- Built-in authorization remains governed by Frappe; hiding a menu does not restrict document access.
- Existing Sidebar/Dock structures vary by v16 release. Publishing fails if required native fields are absent.
