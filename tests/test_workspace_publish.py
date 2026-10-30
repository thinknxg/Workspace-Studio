"""Exercise publish_workspace through insertion, including the v16 title sanitizer."""
import importlib.util
import json
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


class WorkspacePublishTests(unittest.TestCase):
    def setUp(self):
        self.frappe = types.ModuleType("frappe")
        self.frappe._ = lambda value: value
        self.frappe.parse_json = json.loads
        def throw(message):
            raise ValueError(message)
        self.frappe.throw = throw
        self.frappe.db = types.SimpleNamespace(exists=lambda dt, name: name == "Existing" or bool(self.doc.insert.call_count and name == getattr(self.doc, "name", None)))
        self.doc = types.SimpleNamespace(doctype="Workspace", title=None, label=None)
        self.doc.set = lambda key, value: setattr(self.doc, key, value)
        self.doc.is_new = lambda: True
        self.doc.as_dict = lambda: {"title": self.doc.title, "label": self.doc.label}
        self.doc.save = Mock()
        self.has_title = True
        def insert(**kwargs):
            # Frappe v16.52.0 Workspace.validate calls strip_html(self.title).
            if self.has_title:
                self.doc.title = re.sub("<[^>]*>", "", self.doc.title)
            self.doc.name = self.doc.label or self.doc.title
        self.doc.insert = Mock(side_effect=insert)
        self.frappe.new_doc = Mock(return_value=self.doc)
        self.frappe.get_doc = Mock(return_value=self.doc)
        with patch.dict(sys.modules, {"frappe": self.frappe}):
            spec = importlib.util.spec_from_file_location("native_publish_test", ROOT / "thinknxg_workspace_studio/native.py")
            self.native = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.native)
        self.schema = {key: types.SimpleNamespace(fieldtype="Data") for key in ("title", "label", "content", "module", "public", "icon")}
        self.fields_patch = patch.object(self.native, "fields", return_value=self.schema)
        self.fields_patch.start()
        self.addCleanup(self.fields_patch.stop)
        self.studio = types.SimpleNamespace(layout_json='{"components":[]}', target_workspace=None, workspace_title="Estimation", module_name="Selling", icon=None)
        self.before, self.after = [], []

    def publish(self):
        return self.native.publish_workspace(self.studio, self.before, self.after)

    def test_new_workspace_sets_label_and_title_before_insert(self):
        self.assertEqual(self.publish(), "Estimation")
        self.assertEqual(self.doc.label, "Estimation")
        self.assertEqual(self.doc.title, "Estimation")
        self.doc.insert.assert_called_once_with(ignore_permissions=True)
        self.assertFalse(self.before[0]["existed"])
        self.assertEqual(self.after[0]["document"]["title"], "Estimation")

    def test_missing_or_blank_title_fails_before_insert_and_snapshots(self):
        for title in (None, "", "   "):
            with self.subTest(title=title):
                self.studio.workspace_title = title
                with self.assertRaisesRegex(ValueError, "Workspace title required"):
                    self.publish()
        self.doc.insert.assert_not_called()
        self.assertEqual(self.before, [])
        self.assertEqual(self.after, [])

    def test_existing_workspace_keeps_distinct_title_and_label(self):
        self.studio.target_workspace = "Existing"
        self.doc.name = "Existing"
        self.doc.label, self.doc.title = "Native label", "Native title"
        self.doc.is_new = lambda: False
        self.assertEqual(self.publish(), "Existing")
        self.assertEqual(self.doc.label, "Native label")
        self.assertEqual(self.doc.title, "Native title")
        self.doc.insert.assert_not_called()
        self.doc.save.assert_called_once_with(ignore_permissions=True)
        self.assertTrue(self.before[0]["existed"])

    def test_label_only_schema_remains_supported(self):
        self.schema.pop("title")
        self.has_title = False
        self.assertEqual(self.publish(), "Estimation")
        self.assertEqual(self.doc.label, "Estimation")

    def test_title_only_schema_remains_supported(self):
        self.schema.pop("label")
        self.assertEqual(self.publish(), "Estimation")
        self.assertEqual(self.doc.title, "Estimation")



    def test_restore_keeps_current_lock_timestamp(self):
        self.doc.name = "Existing"
        self.doc.modified = "current"
        self.doc.update = lambda values: self.doc.__dict__.update(values)
        self.doc.get_all_children = lambda: []
        def saved(**kwargs):
            self.assertEqual(self.doc.modified, "current")
            self.assertEqual(self.doc.title, "Restored")
        self.doc.save.side_effect = saved
        self.native.restore({"doctype":"Workspace","name":"Existing","existed":True,"document":{"modified":"old","title":"Restored"}})
        self.doc.save.assert_called_once_with(ignore_permissions=True)

    def test_restore_marks_deleted_child_rows_for_insertion(self):
        self.doc.name = "Existing"
        self.doc.modified = "current"
        self.doc.update = lambda values: self.doc.__dict__.update(values)
        child = types.SimpleNamespace(doctype="Workspace Shortcut", name="deleted-row", set=Mock())
        self.doc.get_all_children = lambda: [child]
        self.native.restore({"doctype":"Workspace","name":"Existing","existed":True,"document":{"modified":"old"}})
        child.set.assert_called_once_with("__islocal", True)

if __name__ == "__main__":
    unittest.main()
