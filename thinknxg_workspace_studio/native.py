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
        current.update(data)
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
            refs["shortcuts"].append({"label":title, "type":cfg.get("link_type","DocType"),"link_to":link_to})
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
        put(doc, ["label","title"], studio.workspace_title, required=True)
        put(doc, ["module"], studio.module_name)
        put(doc, ["public"], 1)
    put(doc, ["icon"], studio.icon or "layout-dashboard")
    put(doc, ["content"], json.dumps(blocks), required=True)
    aliases = {"shortcuts":["shortcuts"],"charts":["charts"],"number_cards":["number_cards"],"quick_lists":["quick_lists"]}
    ref_fields = {
        "shortcuts":{"label":["label"],"type":["type"],"link_to":["link_to"]},
        "charts":{"chart_name":["chart_name"]},
        "number_cards":{"number_card_name":["number_card_name"]},
        "quick_lists":{"quick_list_name":["quick_list_name"]}
    }
    for key, rows in refs.items():
        table = choose("Workspace", aliases[key],table=True,required=bool(rows))
        if table:
            set_child_rows(doc, table, rows, ref_fields[key])
    before = capture("Workspace", target) if existed else None
    saved = write(doc)
    capture_before.append(before or {"doctype":"Workspace","name":saved,"existed":False})
    capture_after.append(capture("Workspace",saved))
    return saved

def publish_navigation(studio, capture_before, capture_after):
    nav = json_value(studio.navigation_json)
    if not nav or "items" not in nav: return None
    dt = "Sidebar" if available("Sidebar") else "Workspace Sidebar" if available("Workspace Sidebar") else None
    if not dt: frappe.throw(_("No supported Sidebar DocType installed"))
    module_field = choose(dt, ["module","module_name"],required=True)
    existing = frappe.db.get_value(dt,{module_field:studio.module_name},"name")
    doc = frappe.get_doc(dt,existing) if existing else frappe.new_doc(dt)
    put(doc,[module_field],studio.module_name)
    put(doc,["title","label"],nav.get("title") or studio.workspace_title)
    table = choose(dt,["items","sidebar_items","links","entries"],table=True,required=True)
    set_child_rows(doc,table,nav["items"],{
        "label":["label","title"],"type":["type","link_type"],
        "link_to":["link_to","link","target"],"icon":["icon"],
        "indent":["indent","level"],"hidden":["hidden","is_hidden"]
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
    existing=frappe.db.get_value(dt,{app_field:app},"name")
    doc=frappe.get_doc(dt,existing) if existing else frappe.new_doc(dt)
    put(doc,[app_field],app)
    table=choose(dt,["items","entries","dock_items","links"],table=True,required=True)
    set_child_rows(doc,table,design["entries"],{
        "title":["title","label"],"icon":["icon"],"sidebar":["sidebar","module"],
        "link_type":["link_type","type"],"link_to":["link_to","target"]
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
    results=[]
    label_field=choose("Desktop Icon",["label","title"],required=True)
    for icon in icons:
        label=icon.get("label")
        if not label: frappe.throw(_("Desktop Icon label required"))
        existing=frappe.db.get_value("Desktop Icon",{label_field:label},"name")
        doc=frappe.get_doc("Desktop Icon",existing) if existing else frappe.new_doc("Desktop Icon")
        put(doc,[label_field],label)
        for key, aliases in {
            "icon":["icon"],"link_to":["link_to","link"],"link_type":["link_type","type"],
            "hidden":["hidden","is_hidden"]
        }.items():
            if key in icon: put(doc,aliases,icon[key],required=True)
        previous=capture("Desktop Icon",existing) if existing else None
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
            for dt in ["Workspace","Workspace Sidebar","Sidebar","Dock","Desktop Icon"] if available(dt)}
