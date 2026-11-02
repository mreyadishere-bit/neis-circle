#!/usr/bin/env python3
"""Regression for repeat OVH Gemini deployments; all operations are in /tmp."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ops/ovh-deploy-timetable-ai-gemini-v1.py"
spec = importlib.util.spec_from_file_location("gemini_repeat_ovh", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RepeatDeployment(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env_stage = self.root / "stage"
        self.env_stage.mkdir()
        self.old_source = self.root / "old-functions"
        (self.old_source / "main").mkdir(parents=True)
        (self.old_source / "main" / "index.ts").write_text("// previous router\n")
        self.secret_old = self.env_stage / "gemini-provider.env"
        self.secret_old.write_text('GEMINI_API_KEY="synthetic-prior-key"\n')
        self.secret_old.chmod(0o600)
        self.edge_overlay = self.root / "edge-integrations.yml"
        self.edge_overlay.write_text(
            "services:\n"
            "  functions:\n"
            "    environment:\n"
            "      BREVO_API_KEY: keep-brevo\n"
            "      LIVEKIT_API_KEY: keep-livekit\n"
            "    volumes:\n"
            f"      - {self.root / 'keep-keys'}:/home/deno/keys:ro\n"
        )
        (self.root / "keep-keys").mkdir()
        self.edge_overlay.chmod(0o600)
        self.overlay = self.root / "gemini.yml"
        self.base = self.root / "base.yml"
        self.base.write_text(
            "services:\n"
            "  functions:\n"
            "    image: busybox:latest\n"
            "    command: [sleep, infinity]\n"
            "    volumes:\n"
            f"      - {self.old_source}:/home/deno/functions:ro\n"
            "    environment:\n"
            "      SUPABASE_URL: https://example.invalid\n"
            "  db:\n"
            "    image: postgres:15\n"
            "    environment:\n"
            "      POSTGRES_DB: critical\n"
        )
        self.active_source = self.old_source
        self._new_attempt("first")
        # Previous successful release already left its override on disk.
        mount = self._config(with_gemini=False)["services"]["functions"]["volumes"]
        entry = next(v for v in mount if v.get("target") == "/home/deno/functions")
        self.overlay.write_text(
            "services:\n  functions:\n    env_file:\n"
            f"      - {self.secret_old}\n"
            "    volumes:\n"
            f"      - {json.dumps(entry, separators=(',', ':'))}\n"
        )
        self.overlay.chmod(0o600)
        self.previous_override = self.overlay.read_bytes()
        self.previous_edge = self.edge_overlay.read_bytes()
        self.assertEqual(self._config(with_gemini=True)["services"]["functions"]["environment"]["GEMINI_API_KEY"],
                         "synthetic-prior-key")

        # Patch all globals and side effects. Nothing is written to OVH.
        for name, value in [
            ("ROOT", self.root), ("STAGE", self.env_stage),
            ("EDGE_OVERLAY", self.edge_overlay),
            ("GEMINI_OVERLAY", self.overlay),
            ("EXISTING_TIMETABLE_OVERLAY", self.root / "nonexistent-timetable.yml"),
            ("DOCKER", ["sudo", "-n", "/usr/bin/docker"]),
        ]:
            self._patch(name, value)
        self._patch("compose_cmd", self.compose_cmd)
        self._patch("call", self.fake_call)
        self._patch("verify_edge_endpoint", lambda anon: None)
        self._patch("read_ovh_env", lambda: ("public-anon", "synthetic-current-key"))

    def _patch(self, name, value):
        p = patch.object(mod, name, value)
        p.start()
        self.addCleanup(p.stop)

    def _new_attempt(self, name):
        release = self.root / ("release-" + name)
        new_env = self.env_stage / ("gemini-provider-" + name + ".env")
        new_backup = self.env_stage / ("gemini-override.before-" + name + ".yml")
        (self.env_stage / "index.ts").write_text("// new timetable AI " + name + "\n")
        for key, value in [
            ("RELEASE_ID", name), ("EDGE_REL", release),
            ("GEMINI_ENV_FILE", new_env),
            ("GEMINI_OVERRIDE_BACKUP", new_backup),
        ]:
            setattr(mod, key, value)

    def compose_cmd(self, include_edge=True, include_gemini=None):
        args = ["docker", "compose", "-p", "neis-gemini-repeat-test", "-f", str(self.base)]
        if include_edge:
            args += ["-f", str(self.edge_overlay)]
            if include_gemini is None:
                include_gemini = self.overlay.is_file()
            if include_gemini:
                args += ["-f", str(self.overlay)]
        return args

    def _config(self, with_gemini=True):
        args = self.compose_cmd(True, with_gemini) + ["config", "--format", "json"]
        res = subprocess.run(args, cwd=self.root, capture_output=True, text=True)
        if res.returncode:
            raise RuntimeError("TEST_FIXTURE_COMPOSE_INVALID")
        return json.loads(res.stdout)

    def fake_call(self, args, timeout=70, check=True):
        if args[-2:] == ["inspect", "supabase-edge-functions"]:
            return json.dumps([{
                "State": {"Running": True},
                "Mounts": [{
                    "Type": "bind",
                    "Destination": "/home/deno/functions",
                    "Source": str(self.active_source),
                }],
            }])
        if "up" in args and "functions" in args:
            if getattr(self, "fail_next_activation", False):
                self.fail_next_activation = False
                raise RuntimeError("SIMULATED_RECREATE_FAILURE")
            self.active_source = Path(mod.edge_mount(self._config())["source"])
            return ""
        res = subprocess.run(args, cwd=self.root, capture_output=True, text=True, timeout=timeout)
        if check and res.returncode:
            raise RuntimeError("TEST_COMPOSE_COMMAND_FAILED")
        return res.stdout

    def test_repeat_deployment_preserves_all_existing_settings(self):
        mod.deploy_edge_function("public-anon", "synthetic-current-key")
        self.assertEqual(self.active_source, mod.EDGE_REL / "functions")
        self.assertEqual(self.previous_edge, self.edge_overlay.read_bytes())
        self.assertEqual(self.previous_override, mod.GEMINI_OVERRIDE_BACKUP.read_bytes())
        self.assertTrue(self.secret_old.exists())
        self.assertEqual(mod.GEMINI_ENV_FILE.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self._config()["services"]["functions"]["environment"]["BREVO_API_KEY"], "keep-brevo")
        self.assertEqual(self._config()["services"]["functions"]["environment"]["LIVEKIT_API_KEY"], "keep-livekit")
        self.assertEqual(self._config()["services"]["db"]["environment"]["POSTGRES_DB"], "critical")
        previous_release = mod.EDGE_REL
        previous_override = self.overlay.read_bytes()
        previous_secret = mod.GEMINI_ENV_FILE

        self._new_attempt("second")
        mod.deploy_edge_function("public-anon", "synthetic-rotated-key")
        self.assertEqual(self.active_source, mod.EDGE_REL / "functions")
        self.assertNotEqual(self.active_source, previous_release / "functions")
        self.assertTrue((previous_release / "functions" / "main" / "index.ts").exists())
        self.assertTrue(previous_secret.exists())
        self.assertEqual(previous_override, mod.GEMINI_OVERRIDE_BACKUP.read_bytes())
        self.assertEqual(self._config()["services"]["functions"]["environment"]["GEMINI_API_KEY"],
                         "synthetic-rotated-key")
        self.assertEqual(self.previous_edge, self.edge_overlay.read_bytes())

    def test_failed_redeployment_restores_prior_active_configuration(self):
        self.fail_next_activation = True
        with self.assertRaisesRegex(RuntimeError, "SIMULATED_RECREATE_FAILURE"):
            mod.deploy_edge_function("public-anon", "synthetic-new-key")
        self.assertEqual(self.overlay.read_bytes(), self.previous_override)
        self.assertEqual(self.active_source, self.old_source)
        self.assertTrue(self.secret_old.exists())
        self.assertFalse(mod.GEMINI_ENV_FILE.exists())
        self.assertEqual(self.previous_edge, self.edge_overlay.read_bytes())
        self.assertEqual(self._config()["services"]["functions"]["environment"]["GEMINI_API_KEY"],
                         "synthetic-prior-key")

    def test_unexpected_extra_service_in_override_fails_closed(self):
        self.overlay.write_bytes(self.previous_override + b"  db:\n    image: not-allowed\n")
        with self.assertRaisesRegex(RuntimeError, "PREVIOUS_GEMINI_OVERRIDE_UNRECOGNIZED"):
            mod.deploy_edge_function("public-anon", "synthetic-new-key")


if __name__ == "__main__":
    unittest.main(verbosity=2)
