import json
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from thinknxg_workspace_studio import validation

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.frappe=types.ModuleType('frappe')
        self.frappe._=lambda x:x
        self.frappe.whitelist=lambda:lambda fn:fn
        self.frappe.get_roles=lambda:['System Manager']
        self.frappe.PermissionError=PermissionError
        def throw(message, error=ValueError): raise error(message)
        self.frappe.throw=throw
        self.frappe.get_single=lambda dt:types.SimpleNamespace(enable_guarded_publish=True,require_publish_note=True)
        self.frappe.parse_json=json.loads
        self.frappe.scrub=lambda value:value.lower()
        self.frappe.generate_hash=lambda **kwargs:"abcdef"
        self.frappe.db=Mock()
        self.frappe.db.exists.return_value=True
        self.frappe.session=types.SimpleNamespace(user='Administrator')
        self.frappe.clear_cache=Mock()
        utils=types.ModuleType('frappe.utils');utils.now_datetime=lambda:'2026-10-30'
        self.native=types.ModuleType('thinknxg_workspace_studio.native');self.native.publish=Mock()
        package=types.ModuleType('thinknxg_workspace_studio');package.native=self.native
        with patch.dict(sys.modules,{'frappe':self.frappe,'frappe.utils':utils,'thinknxg_workspace_studio':package,'thinknxg_workspace_studio.native':self.native,'thinknxg_workspace_studio.validation':validation}):
            spec=importlib.util.spec_from_file_location('api_under_test',ROOT/'thinknxg_workspace_studio/api.py')
            self.api=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.api)
        self.studio=types.SimpleNamespace(name='design',module_name='Selling',save=Mock())
        self.frappe.get_doc=lambda *args:self.studio
        self.frappe.new_doc=lambda *args:self.studio
        self.api.design_payload=lambda doc:{'layout':{'components':[]},'navigation':{},'dock':{}}
        self.api.snapshot=Mock(return_value=types.SimpleNamespace(name='backup'))

    def test_all_endpoints_reject_non_manager(self):
        self.frappe.get_roles=lambda:['Desk User']
        calls=[('bootstrap',{}),('load',{'name':'x'}),('save_design',{}),('publish',{'name':'x'}),('versions',{'name':'x'}),('rollback',{'version_name':'x'}),('inspect_native',{})]
        for method,args in calls:
            with self.subTest(method=method), self.assertRaises(PermissionError):getattr(self.api,method)(**args)
        self.native.publish.assert_not_called()

    def test_disabled_publish_and_note_gate(self):
        self.frappe.get_single=lambda dt:types.SimpleNamespace(enable_guarded_publish=False)
        with self.assertRaises(ValueError):self.api.publish('design','note')
        self.frappe.get_single=lambda dt:types.SimpleNamespace(enable_guarded_publish=True,require_publish_note=True)
        with self.assertRaises(ValueError):self.api.publish('design',' ')
        self.native.publish.assert_not_called()

    def test_invalid_design_is_rejected_before_native_mutation(self):
        self.api.design_payload=lambda doc:{'layout':{'components':[{'type':'shortcut','title':'Missing','config':{}}]},'navigation':{},'dock':{}}
        with self.assertRaises(ValueError):self.api.publish('design','note')
        self.native.publish.assert_not_called();self.frappe.db.savepoint.assert_not_called()

    def test_failed_native_publish_rolls_back_savepoint(self):
        self.native.publish.side_effect=ValueError('Unsupported native schema')
        with self.assertRaises(ValueError):self.api.publish('design','note')
        self.frappe.db.savepoint.assert_called_once_with('wss_publish')
        self.frappe.db.rollback.assert_called_once_with(save_point='wss_publish')
        self.api.snapshot.assert_not_called()

    def test_success_records_native_before_after_backup(self):
        payload={'result':{'workspace':'Sales'},'before':[{'existed':False}],'after':[{'existed':True}]}
        self.native.publish.return_value=payload
        result=self.api.publish('design','Reviewed')
        self.assertEqual(result,{'workspace':'Sales','version':'backup'})
        self.assertEqual(self.studio.status,'Published')
        self.assertEqual(self.api.snapshot.call_args.args[3]['native'],payload)
        self.frappe.db.rollback.assert_not_called()


    def test_new_save_without_module_is_rejected_before_save(self):
        for value in (None, '', '   '):
            with self.subTest(module=value):
                self.studio.module_name=None
                with self.assertRaisesRegex(ValueError, 'Select a Module'):
                    self.api.save_design(title='Orders',module=value)
        self.studio.save.assert_not_called()
        self.api.snapshot.assert_not_called()

    def test_save_with_unavailable_module_is_rejected(self):
        self.frappe.db.exists.return_value=False
        with self.assertRaisesRegex(ValueError, 'selected Module is unavailable'):
            self.api.save_design(name='design',title='Orders',module='Removed')
        self.assertEqual(self.studio.module_name,'Selling')
        self.studio.save.assert_not_called()
        self.api.snapshot.assert_not_called()

    def test_existing_save_omitting_module_retains_saved_module(self):
        self.api.save_design(name='design',title='Orders')
        self.assertEqual(self.studio.module_name,'Selling')
        self.frappe.db.exists.assert_called_once_with('Module Def','Selling')
        self.studio.save.assert_called_once_with(ignore_permissions=True)

    def test_explicit_blank_module_cannot_erase_existing_module(self):
        with self.assertRaisesRegex(ValueError,'Select a Module'):
            self.api.save_design(name='design',title='Orders',module='')
        self.assertEqual(self.studio.module_name,'Selling')
        self.studio.save.assert_not_called()

    def test_new_save_normalizes_and_records_valid_module(self):
        result=self.api.save_design(title='Orders',module=' Selling ')
        self.assertEqual(self.studio.module_name,'Selling')
        self.assertEqual(result['name'],'design')
        self.frappe.db.exists.assert_called_once_with('Module Def','Selling')
        self.api.snapshot.assert_called_once()

    def test_publish_of_legacy_missing_module_stops_before_native_writes(self):
        self.studio.module_name=None
        with self.assertRaisesRegex(ValueError,'Select a Module'):
            self.api.publish('design','Reviewed')
        self.native.publish.assert_not_called()
        self.frappe.db.savepoint.assert_not_called()

if __name__=='__main__':unittest.main()
