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

- Desktop Icon removal from a design does not delete an existing native icon. Desktop order is retained in Studio; native position is not mapped.
- Sidebar nesting controls require an installed Int indent/level field. Check-based child/group schemas remain flat in this editor.
- Preview displays layout and reference placeholders, not live chart data or an embedded native Desk.
- User/department/company assignments are stored, but native runtime personalization is not yet wired into Desk.
- Built-in authorization remains governed by Frappe; hiding a menu does not restrict document access.
- Existing Sidebar/Dock structures vary by v16 release. Publishing fails if required native fields are absent.

## Visual designer

Open Workspace Studio as a **System Manager** or **Workspace Studio Manager**.

1. Choose an existing Studio design or start a new one. Set its title, module, and optional native Workspace target.
2. Switch between **Workspace**, **Sidebar**, **Dock**, and **Desktop Icons**.
3. Drag a palette item onto a block to insert before it, or onto the bottom drop area to append. Clicking the palette also adds an item.
4. Select an item and edit its structured properties. Shortcut destinations use a Frappe Link picker; chart and number card components select existing Dashboard Chart and Number Card documents. Quick Lists select a DocType.
5. Set Workspace width from 1–12 columns, heading level, or text. Move Up/Down provide an alternative to dragging. Sidebar moves include descendants; Indent/Outdent appear only on compatible numeric nesting schemas.
6. Sidebar, Dock and Desktop surfaces activate when an item is added. The **Publish this surface** checkbox distinguishes an absent section (leave native data alone) from an enabled empty list. Disabling removes that section from the saved design after confirmation.
7. **Preview** hides editing controls and renders the selected surface with chart/number placeholders. **Validate** checks the current design. Required destinations and selectors must be completed before Save or Publish.
8. **Save** stores a draft. **Publish** asks for a note, saves the visible design first, and calls the existing guarded native publisher. The button is unavailable when guarded publishing is disabled in Studio Settings. Server role checks remain authoritative.
9. **History / Rollback** lists versions. Published versions offer native rollback, with the existing conflict detection and transaction handling. Rollback restores native documents; it does not replace the current Studio layout with an older design.

Workspace content supports heading, text, shortcut, Dashboard Chart, Number Card, Quick List and spacer. Unsupported saved component types are retained and flagged before publication. Native link types are read from installed metadata; an older saved value remains visible for correction. No JSON editors are required in the designer.

### Saved-format compatibility

No DocType migration is required. Storage remains `layout_json.components`, `navigation_json.items`, `dock_json.entries`, and `dock_json.desktop_icons`. Additional root, component and config keys survive loading and saving. Existing scope is retained. Optional missing sections stay absent until enabled. Incomplete legacy drafts can still be saved by the API; strict publication validation rejects invalid destinations, unsupported types, missing references, invalid nesting/widths and duplicate shortcut/icon labels.

Native publish/rollback endpoints, backups, settings and manager roles are retained. Small metadata-aware adapters map URL shortcuts, modern Sidebar row/link types, and Quick List DocType references without changing saved Studio keys. On layered Dock schemas, Studio selects the site layer (nonstandard, no user), not a personal/app layer. Schemas with absent required fields continue to fail and roll back. Native Select validation and document validation remain Frappe's responsibility; the local preview does not certify schema compatibility.

## Development validation

Run from the repository root:

```sh
node --test tests/designer_model.test.cjs
python -B -m unittest discover -s tests -p 'test_*.py'
```

Browser smoke test: install `playwright` and `jquery@3.7.1` in your development environment, install a Playwright Chromium browser, then run `node tests/browser_smoke.cjs`. Optional `PLAYWRIGHT_MODULE`, `JQUERY_PATH` and `CHROME_PATH` environment variables select preinstalled tooling. The test uses a **mocked Frappe API/control layer** and real headless Chromium to exercise four surfaces, pickers, actual drag/drop, preview, save/reload, preserved scope, validation, and save-before-publish. Python tests use Frappe doubles for manager checks, settings gates, validation-before-write, native reference mapping and publish savepoint rollback. These do not replace a live Bench integration test.

### Required staging checks

- Build assets, reload Desk, and open both an existing saved design and a new design on your installed Frappe/ERPNext v16 patch.
- Confirm actual Link picker search results and permissions for DocTypes, Pages, Reports, Dashboard Charts, Number Cards and the installed navigation link types.
- Publish all enabled surfaces into disposable native targets with a note. Compare native content/reference rows and verify native Desk rendering.
- Verify supported Sidebar nesting, Dock site-layer selection, and Desktop Icon behavior for that patch. Deprecated/read-only native DocTypes may be rejected by Frappe.
- Confirm non-manager denial, disabled-publish settings, native before/after snapshots, successful rollback, and refusal to roll back after a manual native edit.
- Inject an incompatible schema mapping and verify no partial native changes commit.

No server deployment or production certification is included.

### Module selection and editor layout

Choose an existing **Module** before Save or Publish. Missing or deleted modules are rejected before writes with an actionable message. When older API callers omit the module on an existing design, its saved module is retained. A removed module stays visible in the selector for correction rather than silently clearing. No Studio DocType schema change is required.

The page explicitly loads its designer stylesheet as well as its state model. At desktop widths Components, Canvas and Properties appear side by side; medium widths move Properties below, and narrow screens stack the panels. If an older cached page still appears unstyled after updating the code, rebuild the app assets, clear the site cache and hard-refresh Desk.

### Native publishing on current v16 — integration investigation

Current v16 protects app-owned Sidebar documents outside developer mode. Workspace Studio uses the site-wide **Custom Sidebar** layer when available, retaining the older Sidebar mapping for earlier schemas. Published rows are marked as additions, and the native permission resolver remains authoritative.

On the legacy Desktop Icon grid, destinations are real **Workspace** documents. Studio sets the native icon type and validates the Workspace before adapting the archived Dynamic Link declaration used by v16. The site must already use **Desktop Settings → Desktop Icons**; Apps mode is rejected with an actionable message. Studio does not silently switch the global desktop mode.

The draft integration workflow creates a disposable ERPNext 16.51.0 / Frappe 16.52.0 site with real MariaDB and Redis, installs the app, and checks native documents, resolved Sidebar items, Desktop Icon payload visibility and rollback. See the workflow results for evidence; neither local mocks nor a sample front-end preview establish live publishing correctness.
