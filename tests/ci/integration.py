"""Run only on a disposable site, from its bench directory using env/bin/python."""
import json

import frappe

from thinknxg_workspace_studio import api


def run():
    frappe.set_user("Administrator")
    import erpnext
    print("INSTALLED APP VERSIONS", {"frappe": frappe.__version__, "erpnext": erpnext.__version__, "apps": frappe.get_installed_apps()})
    settings = frappe.get_single("Studio Settings")
    settings.enable_guarded_publish = 1
    settings.require_publish_note = 1
    settings.save(ignore_permissions=True)
    title = "WSS Native Integration " + frappe.generate_hash(length=6)
    saved = api.save_design(
        title=title,
        module="Selling",
        layout=json.dumps({"version": 1, "components": [
            {"id": "heading", "type": "heading", "title": title, "config": {"col": 12}},
            {"id": "customer", "type": "shortcut", "title": "Customers", "config": {
                "link_type": "DocType", "link_to": "Customer", "col": 4}},
        ]}),
        navigation=json.dumps({"title": title, "items": [
            {"label": "Studio Customers", "type": "DocType", "link_to": "Customer"},
        ]}),
        dock=json.dumps({"desktop_icons": [
            {"label": title, "link_type": "Workspace", "link_to": title, "icon": "folder-normal"},
        ]}),
    )
    assert not frappe.conf.developer_mode, "Test must exercise ordinary site mode"
    # Apps mode must give a clear error and atomically undo all native writes.
    desktop_settings = frappe.get_single("Desktop Settings")
    desktop_settings.desktop_page = "Apps"
    desktop_settings.save(ignore_permissions=True)
    try:
        api.publish(saved["name"], note="Must reject invisible icons")
    except frappe.ValidationError as error:
        assert "Desktop Settings" in str(error), str(error)
    else:
        raise AssertionError("Apps mode must not report invisible Desktop Icons as published")
    assert not frappe.db.exists("Workspace", title), "Failed publish left a Workspace behind"
    desktop_settings.desktop_page = "Desktop Icons"
    desktop_settings.save(ignore_permissions=True)
    result = api.publish(saved["name"], note="Disposable ERPNext v16 integration test")
    print("PUBLISH RESULT", result)
    workspace = frappe.get_doc("Workspace", result["workspace"])
    assert workspace.title == title
    assert workspace.shortcuts[0].link_to == "Customer"
    assert result["sidebar"], "Sidebar was skipped"
    assert len(result["desktop_icons"]) == 1, "Desktop Icon was skipped"
    from frappe.desk.doctype.sidebar.sidebar import get_module_base, resolve_sidebar
    base = get_module_base("Selling")
    resolved = resolve_sidebar(base.get("name") or "Selling", "Administrator")
    assert resolved, "Selling sidebar is not visible to Administrator"
    assert any(row.get("label") == "Studio Customers" and row.get("link_to") == "Customer" for row in resolved.items), "Published Sidebar item is absent from native runtime"
    print("SIDEBAR RESOLVED", resolved.as_boot_entry())
    icon = frappe.get_doc("Desktop Icon", result["desktop_icons"][0])
    assert icon.icon_type == "Link", "Published Desktop Icon has no runtime icon type"
    assert icon.link_to == title
    from frappe.desk.doctype.desktop_icon.desktop_icon import get_desktop_icons, clear_every_users_desktop_icons
    clear_every_users_desktop_icons()
    visible_icons = get_desktop_icons("Administrator", frappe._dict(module_sidebars={resolved.name: resolved.as_boot_entry()}))
    assert icon.name in [row.name for row in visible_icons], "Saved icon is absent from native desktop payload"
    print("VISIBLE DESKTOP ICON", icon.as_dict())
    before = frappe.parse_json(frappe.get_doc("Studio Version", result["version"]).snapshot_json)["native"]["before"]
    assert any(item["doctype"] == "Custom Sidebar" for item in before), "Modern v16 must publish a site customization, not app-owned Sidebar"
    rollback = api.rollback(result["version"], note="Integration rollback")
    print("ROLLBACK RESULT", rollback)
    assert not frappe.db.exists("Workspace", result["workspace"])
    assert not frappe.db.exists("Desktop Icon", result["desktop_icons"][0])
    frappe.db.rollback()
    print("PASS real ERPNext native publish and rollback")
    return {"status": "passed", "workspace": title}


if __name__ == "__main__":
    import os
    os.chdir("sites")  # Bench commands run inside sites; Frappe log paths depend on it.
    frappe.init(site="studio.local", sites_path=".")
    frappe.connect()
    try:
        run()
    finally:
        frappe.destroy()
