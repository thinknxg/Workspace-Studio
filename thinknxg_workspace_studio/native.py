"""Guarded Frappe v16 native-document publisher with before/after snapshots.

Only modifies native DocTypes when their installed schemas are compatible.
If one required mapping cannot be verified, publishing fails and the transaction rolls back.
"""
import copy
import json
import frappe
from frappe import _

def available(dt):
    return frappe.db.exists("DocType", dt)

def fields(dt):
    return {f.fieldname: f for f in frappe.get_meta(dt).fields} if available(dt) else {}

def choose(dt, names, table=False, required=False):
    ff = fields(dt)
    for name in names:
        if name in ff and (not table or ff[name].fieldtype == "Table"):
            return name
    if required:
        frappe.throw(_("Unsupported native schema for {0}: expected {1}").format(dt, ", ".join(names)))
    return None

def put(doc, names, value, required=False):
    field = choose(doc.doctype, names, required=required)
    if field:
        doc.set(field, value)
    return field

def json_value(value):
    return frappe.parse_json(value or "{}")

def capture(doctype, name):
    if not name or not frappe.db.exists(doctype, name):
        return {"doctype": doctype, "name": name, "existed": False}
    return {"doctype": doctype, "name": name, "existed": True,
            "document": frappe.get_doc(doctype, name).as_dict()}

def restore(snapshot):
    dt, name = snapshot["doctype"], snapshot["name"]
    if not snapshot["existed"]:
        if name and frappe.db.exists(dt, name):
            frappe.delete_doc(dt, name, ignore_permissions=True, force=True)
        return
    data = copy.deepcopy(snapshot["document"])
    if frappe.db.exists(dt, name):
        current = frappe.get_doc(dt, name)
        current_modified = current.modified
        current.update(data)
        # Restore content, not the old optimistic-lock timestamp. The API already
        # checked the published snapshot against the current native document.
        current.modified = current_modified
        # Publication replaces child rows. A snapshot may name rows that were
        # deleted by that replacement; db_update would silently update no row.
        # Mark only missing children for insertion, retaining snapshot identities.
        for row in current.get_all_children():
            if not frappe.db.exists(row.doctype, row.name):
                row.set("__islocal", True)
        if dt == "Desktop Icon" and data.get("link_type") == "Workspace Sidebar" and "icon_type" in fields(dt):
            if not data.get("link_to") or not frappe.db.exists("Workspace", data["link_to"]):
                frappe.throw(_("Cannot restore Desktop Icon: its Workspace no longer exists"))
            current.flags.ignore_links = True
        current.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(data)
        doc.insert(ignore_permissions=True)

def write(doc):
    if doc.is_new():
        doc.insert(ignore_permissions=True)
    else:
        doc.save(ignore_permissions=True)
    return doc.name

def set_child_rows(doc, field_name, items, mapping):
    field = choose(doc.doctype, [field_name], table=True, required=True)
    child_dt = fields(doc.doctype)[field].options
    ff = fields(child_dt)
    doc.set(field, [])
    for item in items:
        row = doc.append(field, {})
        for src, aliases in mapping.items():
            if src not in item: continue
            dest = next((a for a in aliases if a in ff), None)
            if dest is None:
                frappe.throw(_("Missing child field mapping for {0}.{1}").format(child_dt, src))
            row.set(dest, item[src])

def workspace_blocks(design):
    blocks = []
    refs = {"shortcuts": [], "charts": [], "number_cards": [], "quick_lists": []}
    for component in design.get("components", []):
        kind = component.get("type")
        cfg = component.get("config") or {}
        title = component.get("title") or ""
        data = {"col": max(1, min(12, int(cfg.get("col") or 4)))}
        if kind == "heading":
            typ = "header"; data.update(text=title, level=cfg.get("level", 4))
        elif kind == "text":
            typ = "text"; data["body"] = component.get("description") or cfg.get("body") or ""
        elif kind == "spacer":
            typ = "spacer"
        elif kind == "shortcut":
            typ = "shortcut"
            link_to = cfg.get("link_to")
            if not link_to: frappe.throw(_("Shortcut requires config.link_to"))
            data["shortcut_name"] = title
            refs["shortcuts"].append({"label":title, "type":cfg.get("link_type","DocType"),
                **({"url":link_to} if cfg.get("link_type") == "URL" else {"link_to":link_to})})
        elif kind in ("chart","number_card","quick_list"):
            key = {"chart":"chart_name","number_card":"number_card_name","quick_list":"quick_list_name"}[kind]
            name = cfg.get(key)
            if not name: frappe.throw(_("{0} requires config.{1}").format(kind,key))
            typ=kind; data[key] = name; refs[{"chart":"charts","number_card":"number_cards","quick_list":"quick_lists"}[kind]].append({key:name})
        else:
            frappe.throw(_("Unsupported native workspace component: {0}").format(kind))
        blocks.append({"id":component.get("id") or frappe.generate_hash(length=10),"type":typ,"data":data})
    return blocks, refs

def publish_workspace(studio, capture_before, capture_after):
    design = json_value(studio.layout_json)
    blocks, refs = workspace_blocks(design)
    target = studio.target_workspace
    existed = bool(target and frappe.db.exists("Workspace", target))
    if target and not existed:
        frappe.throw(_("Specified Workspace does not exist: {0}").format(target))
    doc = frappe.get_doc("Workspace", target) if existed else frappe.new_doc("Workspace")
    if not existed:
        title = (studio.workspace_title or "").strip()
        if not title:
            frappe.throw(_("Workspace title required"))
        # v16 has both fields: label names the document, title is validated separately.
        # Retain compatibility with schemas that expose only one of them.
        put(doc, ["title", "label"], title, required=True)
        put(doc, ["label"], title)
        put(doc, ["module"], studio.module_name)
        put(doc, ["public"], 1)
    put(doc, ["icon"], studio.icon or "layout-dashboard")
    put(doc, ["content"], json.dumps(blocks), required=True)
    aliases = {"shortcuts":["shortcuts"],"charts":["charts"],"number_cards":["number_cards"],"quick_lists":["quick_lists"]}
    ref_fields = {
        "shortcuts":{"label":["label"],"type":["type"],"link_to":["link_to"],"url":["url"]},
        "charts":{"chart_name":["chart_name"]},
        "number_cards":{"number_card_name":["number_card_name"]},
        "quick_lists":{"quick_list_name":["quick_list_name"]}
    }
    for key, rows in refs.items():
        if key == "quick_lists" and rows:
            quick_table = choose("Workspace", ["quick_lists"], table=True, required=True)
            quick_fields = fields(fields("Workspace")[quick_table].options)
            if "quick_list_name" not in quick_fields and "document_type" in quick_fields:
                rows = [{"document_type": row["quick_list_name"], "label": row["quick_list_name"]} for row in rows]
                ref_fields[key] = {"document_type":["document_type"], "label":["label"]}
        table = choose("Workspace", aliases[key],table=True,required=bool(rows))
        if table:
            set_child_rows(doc, table, rows, ref_fields[key])
    before = capture("Workspace", target) if existed else None
    saved = write(doc)
    capture_before.append(before or {"doctype":"Workspace","name":saved,"existed":False})
    capture_after.append(capture("Workspace",saved))
    return saved

def sidebar_doctype():
    # Current v16 app-owned Sidebar documents are read-only outside developer mode.
    # Site intent belongs in Custom Sidebar; do not bypass the native app-content guard.
    if available("Custom Sidebar") and available("Sidebar"):
        return "Custom Sidebar"
    return "Sidebar" if available("Sidebar") else "Workspace Sidebar" if available("Workspace Sidebar") else None


def publish_navigation(studio, capture_before, capture_after):
    nav = json_value(studio.navigation_json)
    if not nav or "items" not in nav: return None
    dt = sidebar_doctype()
    if not dt: frappe.throw(_("No supported Sidebar DocType installed"))
    module_field = choose(dt, ["module","module_name"],required=True)
    filters = {module_field: studio.module_name}
    if dt == "Custom Sidebar": filters["user"] = ["is", "not set"]
    existing = frappe.db.get_value(dt,filters,"name")
    doc = frappe.get_doc(dt,existing) if existing else frappe.new_doc(dt)
    put(doc,[module_field],studio.module_name)
    if dt == "Custom Sidebar": put(doc,["user"], "", required=True)
    put(doc,["title","label"],nav.get("title") or studio.workspace_title)
    table = choose(dt,["items","sidebar_items","links","entries"],table=True,required=True)
    items = copy.deepcopy(nav["items"])
    child_fields = fields(fields(dt)[table].options)
    if dt == "Custom Sidebar":
        for item in items: item["added"] = 1
    # Modern v16 separates the row kind from the destination DocType.
    if "type" in child_fields and "link_type" in child_fields:
        for item in items:
            item["link_type"] = item.get("type", "DocType")
            item["type"] = "Link"
            if item["link_type"] == "URL": item["url"] = item.pop("link_to", "")
    if any(item.get("indent") for item in items) and not designer_capabilities()["sidebar_indent"]:
        frappe.throw(_("This Sidebar schema does not support numeric nesting"))
    set_child_rows(doc,table,items,{
        "label":["label","title"],"type":["type","link_type"],
        "link_type":["link_type"],"url":["url"],
        "link_to":["link_to","link","target"],"icon":["icon"],
        "indent":["indent","level"],"hidden":["hidden","is_hidden"],"added":["added"]
    })
    previous=capture(dt,existing) if existing else None
    name=write(doc)
    capture_before.append(previous or {"doctype":dt,"name":name,"existed":False})
    capture_after.append(capture(dt,name))
    return name

def publish_dock(studio,capture_before,capture_after):
    design = json_value(studio.dock_json)
    if not design or "entries" not in design: return None
    if not available("Dock"): frappe.throw(_("Dock DocType not available on this Frappe patch"))
    dt="Dock"
    app_field=choose(dt,["app","app_name"],required=True)
    app=design.get("app","erpnext")
    filters = {app_field: app}
    if "user" in fields(dt): filters["user"] = ["in", ["", None]]
    if "standard" in fields(dt): filters["standard"] = 0
    existing=frappe.db.get_value(dt,filters,"name")
    doc=frappe.get_doc(dt,existing) if existing else frappe.new_doc(dt)
    put(doc,[app_field],app)
    table=choose(dt,["items","entries","dock_items","links"],table=True,required=True)
    entries = copy.deepcopy(design["entries"])
    child_fields = fields(fields(dt)[table].options)
    for item in entries:
        if item.get("link_type") == "URL" and "url" in child_fields:
            item["url"] = item.pop("link_to", "")
        if "added" in child_fields: item["added"] = 1
    set_child_rows(doc,table,entries,{
        "title":["title","label"],"icon":["icon"],"sidebar":["sidebar","module"],
        "link_type":["link_type","type"],"link_to":["link_to","target"],
        "url":["url"],"added":["added"]
    })
    previous=capture(dt,existing) if existing else None
    name=write(doc)
    capture_before.append(previous or {"doctype":dt,"name":name,"existed":False})
    capture_after.append(capture(dt,name))
    return name

def publish_desktop_icons(studio,capture_before,capture_after):
    design=json_value(studio.dock_json)
    icons=design.get("desktop_icons")
    if icons is None: return []
    if not available("Desktop Icon"): frappe.throw(_("Desktop Icon DocType is unavailable"))
    if icons and available("Desktop Settings") and "desktop_page" in fields("Desktop Settings"):
        mode = frappe.db.get_single_value("Desktop Settings", "desktop_page") or "Apps"
        if mode != "Desktop Icons":
            frappe.throw(_("Desktop Icons are not visible in Apps mode. Select Desktop Icons in Desktop Settings, then publish again."))
    results=[]
    label_field=choose("Desktop Icon",["label","title"],required=True)
    for icon in icons:
        label=icon.get("label")
        if not label: frappe.throw(_("Desktop Icon label required"))
        existing=frappe.db.get_value("Desktop Icon",{label_field:label},"name")
        doc=frappe.get_doc("Desktop Icon",existing) if existing else frappe.new_doc("Desktop Icon")
        put(doc,[label_field],label)
        values = copy.deepcopy(icon)
        icon_fields = fields("Desktop Icon")
        legacy_grid = "icon_type" in icon_fields and "Workspace Sidebar" in (icon_fields.get("link_type").options or "")
        workspace_link = legacy_grid and values.get("link_type") in ("Workspace", "Workspace Sidebar")
        if workspace_link:
            if not values.get("link_to") or not frappe.db.exists("Workspace", values["link_to"]):
                frappe.throw(_("Desktop Icon destination must be an existing Workspace"))
            # Native v16 retains a deprecated Dynamic Link declaration. Its own icon
            # creator ignores that link after resolving a real Workspace; do the same
            # only after checking the actual Workspace, never for arbitrary targets.
            values["link_type"] = "Workspace Sidebar"
        if legacy_grid:
            put(doc, ["icon_type"], "Link", required=True)
        if values.get("link_type") in ("External", "URL"):
            if legacy_grid: values["link_type"] = "External"
            values["link"] = values.pop("link_to", "")
        for key, aliases in {
            "link":["link"], "icon":["icon"],"link_to":["link_to","link"],"link_type":["link_type","type"],
            "hidden":["hidden","is_hidden"]
        }.items():
            if key in values: put(doc,aliases,values[key],required=True)
        previous=capture("Desktop Icon",existing) if existing else None
        if workspace_link: doc.flags.ignore_links = True
        name=write(doc)
        capture_before.append(previous or {"doctype":"Desktop Icon","name":name,"existed":False})
        capture_after.append(capture("Desktop Icon",name))
        results.append(name)
    return results

def publish(studio):
    before, after = [], []
    result = {"workspace": publish_workspace(studio,before,after),
              "sidebar": publish_navigation(studio,before,after),
              "dock": publish_dock(studio,before,after),
              "desktop_icons": publish_desktop_icons(studio,before,after)}
    return {"result":result,"before":before,"after":after}

def inspect():
    return {dt:[{"fieldname":f.fieldname,"fieldtype":f.fieldtype,"options":f.options}
                 for f in frappe.get_meta(dt).fields]
            for dt in ["Workspace","Workspace Sidebar","Sidebar","Custom Sidebar","Dock","Desktop Icon","Desktop Settings"] if available(dt)}


def designer_capabilities():
    dt = sidebar_doctype()
    table = choose(dt, ["items", "sidebar_items", "links", "entries"], table=True) if dt else None
    child = fields(fields(dt)[table].options) if table else {}
    indent = next((child[k] for k in ("indent", "level") if k in child), None)
    def link_types(doctype, table_names=None):
        ff = fields(doctype)
        if table_names:
            table_name = choose(doctype, table_names, table=True)
            ff = fields(ff[table_name].options) if table_name else {}
        field = ff.get("link_type") or ff.get("type")
        return [x for x in (field.options or "").split("\n") if x] if field and field.fieldtype == "Select" else []
    desktop_types = link_types("Desktop Icon")
    if "icon_type" in fields("Desktop Icon"):
        desktop_types = ["Workspace" if value == "Workspace Sidebar" else value for value in desktop_types]
    return {"sidebar_doctype": dt, "sidebar_indent": bool(indent and indent.fieldtype == "Int"),
            "link_types": {"workspace": link_types("Workspace Shortcut"),
                           "sidebar": link_types(dt, ["items", "sidebar_items", "links", "entries"]) if dt else [],
                           "dock": link_types("Dock", ["items", "entries", "dock_items", "links"]),
                           "desktop": desktop_types}}
