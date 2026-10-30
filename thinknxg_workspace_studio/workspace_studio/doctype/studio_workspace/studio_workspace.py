import frappe
from frappe.model.document import Document

class StudioWorkspace(Document):
    def validate(self):
        design = frappe.parse_json(self.layout_json or '{"components":[]}')
        if not isinstance(design, dict) or not isinstance(design.get("components"),list):
            frappe.throw("Layout must be JSON object with a components list")
