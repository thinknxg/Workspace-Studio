import frappe

def after_install():
    if not frappe.db.exists("Role", "Workspace Studio Manager"):
        frappe.get_doc({"doctype":"Role","role_name":"Workspace Studio Manager"}).insert(ignore_permissions=True)
