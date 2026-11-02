import importlib.util
from pathlib import Path
import urllib.error
import unittest
from unittest.mock import patch

path=Path(__file__).resolve().parents[1]/"scripts/ops/ovh-deploy-timetable-ai-cloudflare-v1.py"
spec=importlib.util.spec_from_file_location("cloudflare_deploy_retry",str(path))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class EdgeStartupRetry(unittest.TestCase):
    @staticmethod
    def error(status):
        return urllib.error.HTTPError(
            "https://example.invalid/functions/v1/timetable-ai-cloudflare",
            status,"Synthetic fixture",{},None
        )

    def test_transient_503_then_expected_auth_401(self):
        statuses=[503,503,503,401]
        calls=[]
        def urlopen(request,timeout=0):
            calls.append(1)
            raise self.error(statuses.pop(0))
        with patch.object(mod.urllib.request,"urlopen",urlopen), patch.object(mod.time,"sleep") as sleeper:
            mod.verify_edge_endpoint("synthetic-public-anon-key")
        self.assertEqual(len(calls),4)
        self.assertEqual(sleeper.call_count,3)

    def test_persistent_503_rolls_back_after_bounded_retries(self):
        calls=[]
        def urlopen(request,timeout=0):
            calls.append(1)
            raise self.error(503)
        with patch.object(mod.urllib.request,"urlopen",urlopen), patch.object(mod.time,"sleep") as sleeper:
            with self.assertRaisesRegex(RuntimeError,"EDGE_UNAUTH_STATUS_UNEXPECTED_503"):
                mod.verify_edge_endpoint("synthetic-public-anon-key")
        self.assertEqual(len(calls),17)
        self.assertEqual(sleeper.call_count,16)

    def test_auth_401_immediate(self):
        with patch.object(mod.urllib.request,"urlopen",side_effect=self.error(401)) as req,patch.object(mod.time,"sleep") as sleeper:
            mod.verify_edge_endpoint("synthetic-public-anon-key")
        self.assertEqual(req.call_count,1)
        sleeper.assert_not_called()

if __name__=="__main__":
    unittest.main(verbosity=2)
