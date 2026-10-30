import ast
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from thinknxg_workspace_studio.validation import validate_design

class ValidationTests(unittest.TestCase):
    def test_legacy_unknown_fields_and_missing_optional_sections(self):
        self.assertEqual(validate_design({"components": [], "extra": 1}, {}, {"extra": 2}, True), [])

    def test_draft_allows_incomplete_config_but_not_malformed_arrays(self):
        self.assertEqual(validate_design({"components": [{"type": "chart"}]}, {}, {}), [])
        self.assertTrue(validate_design({"components": []}, {"items": {}}, {}))
        self.assertTrue(validate_design({"components": [None]}, {}, {}))

    def test_publish_requires_destinations_and_reference_selectors(self):
        for kind, cfg in [("shortcut", {}), ("chart", {}), ("number_card", {}), ("quick_list", {})]:
            with self.subTest(kind=kind):
                self.assertTrue(validate_design({"components": [{"type":kind,"title":"X","config":cfg}]}, {}, {}, True))

    def test_nested_duplicates_and_width_errors(self):
        errors=validate_design({"components":[{"type":"spacer","config":{"col":13}}]}, {"items":[{"label":"X","link_to":"X","indent":2}]}, {"desktop_icons":[{"label":"X","link_to":"X"},{"label":"X","link_to":"X"}]}, True)
        self.assertEqual(len(errors), 3)

    def test_url_validation(self):
        for target in ("javascript:alert(1)", "data:text/html,test"):
            self.assertTrue(validate_design({"components":[]}, {}, {"entries":[{"title":"X","link_type":"URL","link_to":target}]}, True))

    def test_all_python_sources_parse(self):
        for source in ROOT.rglob('*.py'):
            ast.parse(source.read_text(encoding='utf-8'), filename=str(source))

class NativeAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fake=types.ModuleType('frappe')
        fake._=lambda value:value
        fake.throw=lambda message: (_ for _ in ()).throw(ValueError(message))
        fake.generate_hash=lambda **kwargs:'test-id'
        cls.fake=fake
        with patch.dict(sys.modules, {'frappe':fake}):
            spec=importlib.util.spec_from_file_location('native_under_test',ROOT/'thinknxg_workspace_studio/native.py')
            cls.native=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.native)

    def test_shortcut_url_keeps_studio_schema_maps_native_url(self):
        blocks, refs=self.native.workspace_blocks({"components":[{"type":"shortcut","title":"Docs","config":{"link_type":"URL","link_to":"https://example.com"}}]})
        self.assertEqual(refs['shortcuts'][0]['url'],'https://example.com')
        self.assertNotIn('link_to',refs['shortcuts'][0])
        self.assertEqual(blocks[0]['data']['shortcut_name'],'Docs')

    def test_existing_chart_number_and_quick_list_references(self):
        for kind,key in [('chart','chart_name'),('number_card','number_card_name'),('quick_list','quick_list_name')]:
            blocks,refs=self.native.workspace_blocks({'components':[{'type':kind,'config':{key:'Sales'}}]})
            self.assertEqual(blocks[0]['data'][key],'Sales')

    def test_missing_shortcut_destination_fails(self):
        with self.assertRaises(ValueError):
            self.native.workspace_blocks({'components':[{'type':'shortcut','config':{}}]})

if __name__ == '__main__':
    unittest.main()
