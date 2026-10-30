import json
import frappe
from frappe import _
from frappe.utils import now_datetime
from thinknxg_workspace_studio import native
from thinknxg_workspace_studio.validation import validate_design

MANAGERS={"System Manager","Workspace Studio Manager"}

def guard():
    if not MANAGERS.intersection(frappe.get_roles()):
        frappe.throw(_("Workspace Studio administrator permission required"),frappe.PermissionError)

def snapshot(studio,action,summary,payload):
    number=frappe.db.count("Studio Version",{"studio_workspace":studio.name})+1
    return frappe.get_doc({
        "doctype":"Studio Version","studio_workspace":studio.name,
        "version_number":number,"action":action,"change_summary":summary,
        "snapshot_json":json.dumps(payload,default=str,ensure_ascii=False)
    }).insert(ignore_permissions=True)

def design_payload(doc):
    return {"title":doc.workspace_title,"module":doc.module_name,"icon":doc.icon,
            "scope":doc.scope,"target_workspace":doc.target_workspace,
            "layout":frappe.parse_json(doc.layout_json or "{}"),
            "navigation":frappe.parse_json(doc.navigation_json or "{}"),
            "dock":frappe.parse_json(doc.dock_json or "{}")}

@frappe.whitelist()
def bootstrap():
    guard()
    return {"modules":frappe.get_all("Module Def",pluck="name",order_by="name"),
            "native_workspaces":frappe.get_all("Workspace",fields=["name","title","module"],limit_page_length=500),
            "studio_workspaces":frappe.get_all("Studio Workspace",fields=["name","workspace_title","status"],limit_page_length=500),
            "schema":native.inspect(),
            "capabilities":native.designer_capabilities(),
            "can_publish":bool(frappe.get_single("Studio Settings").enable_guarded_publish)}

@frappe.whitelist()
def load(name):
    guard()
    return frappe.get_doc("Studio Workspace",name).as_dict()

def require_module(value):
    module = value.strip() if isinstance(value, str) else ""
    if not module:
        frappe.throw(_("Select a Module in Workspace Studio before saving or publishing."))
    if not frappe.db.exists("Module Def", module):
        frappe.throw(_("The selected Module is unavailable. Choose an existing Module in Workspace Studio."))
    return module

@frappe.whitelist()
def save_design(name=None,title=None,module=None,layout=None,navigation=None,dock=None,target_workspace=None,scope="Global"):
    guard()
    design=frappe.parse_json(layout or '{"components":[]}')
    if not isinstance(design,dict) or not isinstance(design.get("components"),list):
        frappe.throw(_("Layout must include a components list"))
    nav = frappe.parse_json(navigation) if navigation is not None else {}
    dock_design = frappe.parse_json(dock) if dock is not None else {}
    errors = validate_design(design, nav, dock_design)
    if errors: frappe.throw("; ".join(errors))
    if name:
        doc=frappe.get_doc("Studio Workspace",name)
    else:
        if not title: frappe.throw(_("Title required"))
        doc=frappe.new_doc("Studio Workspace")
        doc.workspace_key=frappe.scrub(title)+"_"+frappe.generate_hash(length=6)
    selected_module = require_module(module if module is not None else doc.module_name)
    doc.workspace_title=title or doc.workspace_title
    doc.module_name=selected_module
    doc.scope=scope
    doc.target_workspace=target_workspace or None
    doc.layout_json=json.dumps(design,ensure_ascii=False)
    if navigation is not None: doc.navigation_json=json.dumps(frappe.parse_json(navigation),ensure_ascii=False)
    if dock is not None: doc.dock_json=json.dumps(frappe.parse_json(dock),ensure_ascii=False)
    doc.status="Draft"
    doc.save(ignore_permissions=True)
    snapshot(doc,"Saved","Design updated",{"studio":design_payload(doc)})
    return {"name":doc.name,"status":doc.status}

@frappe.whitelist()
def publish(name,note=None):
    guard()
    if not frappe.get_single("Studio Settings").enable_guarded_publish:
        frappe.throw(_("Guarded publishing is disabled in Studio Settings"))
    if frappe.get_single("Studio Settings").require_publish_note and not (note or "").strip():
        frappe.throw(_("Publication note required"))
    studio=frappe.get_doc("Studio Workspace",name)
    require_module(studio.module_name)
    payload = design_payload(studio)
    errors = validate_design(payload["layout"], payload["navigation"], payload["dock"], strict=True)
    if errors: frappe.throw("; ".join(errors))
    if "items" in payload["navigation"] and not studio.module_name:
        frappe.throw(_("Sidebar requires a module"))
    # All native updates, snapshots and status changes commit together or roll back.
    frappe.db.savepoint("wss_publish")
    try:
        published=native.publish(studio)
        studio.target_workspace=published["result"]["workspace"]
        studio.status="Published"
        studio.last_published_on=now_datetime()
        studio.last_published_by=frappe.session.user
        studio.save(ignore_permissions=True)
        version=snapshot(studio,"Published",note or "Published",
                         {"studio":design_payload(studio),"native":published})
        frappe.clear_cache()
        return {"version":version.name,**published["result"]}
    except Exception:
        frappe.db.rollback(save_point="wss_publish")
        raise

@frappe.whitelist()
def versions(name):
    guard()
    return frappe.get_all("Studio Version",filters={"studio_workspace":name},
        fields=["name","version_number","action","change_summary","creation"],
        order_by="version_number desc",limit_page_length=100)

@frappe.whitelist()
def rollback(version_name,note=None):
    guard()
    version=frappe.get_doc("Studio Version",version_name)
    data=frappe.parse_json(version.snapshot_json)
    native_change=data.get("native")
    if not native_change: frappe.throw(_("Version has no native-document backup"))
    studio=frappe.get_doc("Studio Workspace",version.studio_workspace)
    before=native_change["before"]; after=native_change["after"]
    # Refuse to overwrite later manual changes.
    for expected in after:
        if not expected["existed"]: continue
        if not frappe.db.exists(expected["doctype"],expected["name"]):
            frappe.throw(_("Native document deleted since publication: {0}").format(expected["name"]))
        now=frappe.get_doc(expected["doctype"],expected["name"]).as_dict()
        recorded=expected["document"]
        if str(now.get("modified")) != str(recorded.get("modified")):
            frappe.throw(_("Native document changed since publication: {0}").format(expected["name"]))
    frappe.db.savepoint("wss_rollback")
    try:
        for item in reversed(before):
            native.restore(item)
        studio.status="Draft"
        studio.save(ignore_permissions=True)
        new=snapshot(studio,"Rolled Back",note or "Restored native backup",
                     {"restored_from":version.name,"studio":design_payload(studio)})
        frappe.clear_cache()
        return {"restored":len(before),"version":new.name}
    except Exception:
        frappe.db.rollback(save_point="wss_rollback")
        raise

@frappe.whitelist()
def inspect_native():
    guard()
    return native.inspect()
