"""Run only on a disposable ERPNext site: bench execute wss_integration.run."""
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
            {"label": title, "link_type": "Workspace Sidebar", "link_to": title, "icon": "folder-normal"},
        ]}),
    )
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
    print("SIDEBAR RESOLVED", resolved)
    icon = frappe.get_doc("Desktop Icon", result["desktop_icons"][0])
    assert icon.icon_type == "Link", "Published Desktop Icon has no runtime icon type"
    assert icon.link_to == title
    before = frappe.parse_json(frappe.get_doc("Studio Version", result["version"]).snapshot_json)["native"]["before"]
    assert any(item["doctype"] == "Custom Sidebar" for item in before), "Modern v16 must publish a site customization, not app-owned Sidebar"
    rollback = api.rollback(result["version"], note="Integration rollback")
    print("ROLLBACK RESULT", rollback)
    assert not frappe.db.exists("Workspace", result["workspace"])
    assert not frappe.db.exists("Desktop Icon", result["desktop_icons"][0])
    frappe.db.rollback()
    print("PASS real ERPNext native publish and rollback")
    return {"status": "passed", "workspace": title}
